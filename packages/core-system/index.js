import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const port = 3001;
const registryPort = 3000;
const uiRefreshIntervalMs = 60000;
const fallbackPrompt = 'Generate an adaptive interface for the registered device.';

const serviceRegistryByType = {
  generic: new Map(),
  capability: new Map(),
  device: new Map(),
};
const capabilityAliasIndex = new Map();
const deviceRegistry = new Map();
const deviceSockets = new Map(); // deviceId -> Set<WebSocket>

const nowIsoString = () => new Date().toISOString();

const normalizeUrl = (url) => {
  if (!url) return url;
  return url.endsWith('/') ? url.slice(0, -1) : url;
};

const unregisterCapabilityAliases = (record) => {
  if (!record?.provides) return;
  record.provides.forEach((alias) => {
    if (capabilityAliasIndex.get(alias) === record.name) {
      capabilityAliasIndex.delete(alias);
    }
  });
};

const normalizeEndpoints = (endpoints = {}, directEndpoint) => {
  const normalized = { ...endpoints };
  if (directEndpoint) {
    normalized.default = directEndpoint;
  }
  return normalized;
};

const composeUrl = (base, path = '/') => {
  if (!path || path === '/') return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

const resolveEndpointConfig = (moduleRecord) => {
  if (!moduleRecord) return null;

  const endpoints = moduleRecord.endpoints || {};
  const endpointConfig = endpoints.default || endpoints.invoke || moduleRecord.endpoint;

  if (!endpointConfig) return null;

  if (typeof endpointConfig === 'string') {
    return {
      url: composeUrl(moduleRecord.url, endpointConfig),
      method: 'GET',
      headers: {},
    };
  }

  const { path = '/', method = 'GET', headers = {} } = endpointConfig;

  return {
    url: composeUrl(moduleRecord.url, path),
    method: (method || 'GET').toUpperCase(),
    headers,
  };
};

const collectCapabilityData = async (requestedCapabilities = [], context = {}) => {
  const capabilityData = {};
  const missingCapabilities = [];

  await Promise.all(
    requestedCapabilities.map(async (capabilityName) => {
      const moduleName = capabilityAliasIndex.get(capabilityName) || capabilityName;
  const moduleRecord = serviceRegistryByType.capability.get(moduleName);

      if (!moduleRecord) {
        missingCapabilities.push(capabilityName);
        capabilityData[capabilityName] = { error: 'Capability not registered' };
        console.warn(`[Core] Capability '${capabilityName}' is missing from the registry.`);
        return;
      }

      const endpointConfig = resolveEndpointConfig(moduleRecord);

      if (!endpointConfig) {
        capabilityData[capabilityName] = {
          source: moduleRecord.name,
          metadata: moduleRecord.metadata || null,
          note: 'No executable endpoint registered',
        };
        console.warn(`[Core] Capability '${moduleRecord.name}' registered without an executable endpoint.`);
        return;
      }

      const requestOptions = {
        method: endpointConfig.method,
        headers: { ...endpointConfig.headers },
      };

      if (endpointConfig.method !== 'GET') {
        requestOptions.headers['Content-Type'] = requestOptions.headers['Content-Type'] || 'application/json';
        requestOptions.body = JSON.stringify({ context });
      }

      try {
        console.log(`[Core] Fetching capability '${capabilityName}' from ${endpointConfig.method} ${endpointConfig.url}`);
        const response = await fetch(endpointConfig.url, requestOptions);

        if (!response.ok) {
          capabilityData[capabilityName] = {
            source: moduleRecord.name,
            error: `Capability responded with status ${response.status}`,
          };
          console.error(`[Core] Capability '${moduleRecord.name}' responded with status ${response.status}.`);
          return;
        }

        const data = await response.json();
        capabilityData[capabilityName] = {
          source: moduleRecord.name,
          data,
        };
        console.log(`[Core] Capability '${moduleRecord.name}' data received successfully.`);
      } catch (error) {
        capabilityData[capabilityName] = {
          source: moduleRecord.name,
          error: error.message,
        };
        console.error(`[Core] Error fetching capability '${moduleRecord.name}': ${error.message}`);
      }
    })
  );

  return { capabilityData, missingCapabilities };
};

const registrySnapshot = () => ({
  capabilities: Array.from(serviceRegistryByType.capability.values()),
  devices: Array.from(serviceRegistryByType.device.values()),
  services: Array.from(serviceRegistryByType.generic.values()),
});

const registerWithServiceRegistry = async () => {
  try {
    await fetch('http://localhost:3000/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'core-system',
        url: `http://localhost:${port}`,
      })
    });
    console.log('Registered with service registry');
  } catch (error) {
    console.error('Error registering with service registry:', error);
  }
};

const ensureSocketSet = (deviceId) => {
  if (!deviceId) return null;
  if (!deviceSockets.has(deviceId)) {
    deviceSockets.set(deviceId, new Set());
  }
  return deviceSockets.get(deviceId);
};

const dispatchUiToClients = (deviceId, uiDefinition) => {
  const payload = JSON.stringify({
    deviceId: deviceId || null,
    generatedAt: nowIsoString(),
    ui: uiDefinition,
  });

  if (deviceId) {
    const sockets = deviceSockets.get(deviceId);
    if (sockets && sockets.size > 0) {
      sockets.forEach((socket) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(payload);
        }
      });
      return;
    }
    console.warn(`No active sockets for device ${deviceId}; UI not delivered.`);
  }

  // Fallback broadcast
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
};

const generateUiForDevice = async ({
  deviceId,
  prompt,
  schema,
  thingDescription,
  capabilities,
  broadcast = true,
}) => {
  const deviceInfo = deviceId ? deviceRegistry.get(deviceId) : undefined;

  if (deviceId && !deviceInfo) {
    throw new Error(`Unknown device '${deviceId}'.`);
  }

  const resolvedPrompt = prompt || deviceInfo?.defaultPrompt || fallbackPrompt;
  const resolvedSchema = schema && Object.keys(schema).length > 0
    ? schema
    : deviceInfo?.uiSchema
      ? { ...deviceInfo.uiSchema }
      : { components: {} };

  if (!resolvedSchema.name) {
    resolvedSchema.name = deviceInfo?.id || 'core-system';
  }

  const resolvedThingDescription = thingDescription || deviceInfo?.thingDescription || null;
  const resolvedCapabilities = Array.isArray(capabilities) && capabilities.length > 0
    ? capabilities
    : Array.isArray(deviceInfo?.capabilities)
      ? deviceInfo.capabilities
      : [];

  const { capabilityData, missingCapabilities } = await collectCapabilityData(resolvedCapabilities, {
    prompt: resolvedPrompt,
    deviceId,
    device: deviceInfo,
  });

  const knowledgeBasePayload = {
    prompt: resolvedPrompt,
    schema: resolvedSchema,
    thingDescription: resolvedThingDescription,
    capabilities: resolvedCapabilities,
    capabilityData,
    missingCapabilities,
    deviceId,
    device: deviceInfo,
  };

  console.log(`[Core] Generating UI for device '${deviceId || 'broadcast'}' with capabilities: ${resolvedCapabilities.join(', ') || 'none'}`);

  let requirementKnowledgeBaseResponse;
  try {
    requirementKnowledgeBaseResponse = await fetch('http://localhost:3005/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(knowledgeBasePayload),
    });
  } catch (error) {
    console.error('[Core] Failed to reach knowledge base service:', error.message);
    throw new Error(`Knowledge base unreachable: ${error.message}`);
  }

  if (!requirementKnowledgeBaseResponse.ok) {
    const errorBody = await requirementKnowledgeBaseResponse.text();
    console.error(`[Core] Knowledge base responded with status ${requirementKnowledgeBaseResponse.status}: ${errorBody}`);
    throw new Error(`Knowledge base error (${requirementKnowledgeBaseResponse.status})`);
  }

  console.log('[Core] Knowledge base responded successfully; parsing UI payload.');

  let generatedUi = await requirementKnowledgeBaseResponse.json();

  if (!generatedUi || Object.keys(generatedUi).length === 0) {
    generatedUi = {
      type: 'container',
      children: [
        { type: 'text', content: 'Error: UI generation failed. The generated UI is empty.' },
      ],
    };
  }

  if (broadcast) {
    dispatchUiToClients(deviceId, generatedUi);
    console.log(`[Core] Dispatched UI to device '${deviceId || 'broadcast'}'.`);
  }

  return generatedUi;
};

const scheduleDeviceUiRefresh = () => {
  setInterval(() => {
    deviceRegistry.forEach((record) => {
      generateUiForDevice({ deviceId: record.id }).catch((error) => {
        console.error(`Failed to refresh UI for device ${record.id}:`, error.message);
      });
    });
  }, uiRefreshIntervalMs);
};

const registryApp = express();
registryApp.use(express.json());
registryApp.use(cors());

const getRegistryForType = (type = 'generic') => {
  if (type === 'capability') return serviceRegistryByType.capability;
  if (type === 'device') return serviceRegistryByType.device;
  return serviceRegistryByType.generic;
};

const registerService = ({ name, url, metadata = {}, capabilities = [], type = 'generic' }) => {
  if (!name || !url) {
    throw new Error('Service registration requires `name` and `url`.');
  }

  const registry = getRegistryForType(type);

  const normalizedUrl = normalizeUrl(url);
  const existing = registry.get(name);
  const now = nowIsoString();

  const record = {
    name,
    url: normalizedUrl,
    metadata,
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    registeredAt: existing?.registeredAt || now,
    lastHeartbeat: now,
    type,
  };

  registry.set(name, record);
  return record;
};

registryApp.post('/register', (req, res) => {
  try {
    const record = registerService(req.body || {});
    console.log(`Service registry: registered ${record.name} at ${record.url}`);
    res.json({ status: 'registered', service: record });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const findService = (name) => {
  return (
    serviceRegistryByType.generic.get(name) ||
    serviceRegistryByType.capability.get(name) ||
    serviceRegistryByType.device.get(name)
  );
};

registryApp.get('/services/:name', (req, res) => {
  const service = findService(req.params.name);
  if (!service) {
    return res.status(404).json({ error: `Service '${req.params.name}' not found.` });
  }
  res.json(service);
});

registryApp.get('/services', (_req, res) => {
  res.json({
    services: Array.from(serviceRegistryByType.generic.values()),
    capabilities: Array.from(serviceRegistryByType.capability.values()),
    devices: Array.from(serviceRegistryByType.device.values()),
  });
});

app.get('/', (_req, res) => {
  res.send('UI Generator');
});

app.get('/registry', (_req, res) => {
  res.json(registrySnapshot());
});

app.post('/register/capability', (req, res) => {
  const { name, url, provides = [], metadata = {}, endpoints = {}, endpoint, defaultEndpoint } = req.body;

  if (!name || !url) {
    return res.status(400).json({ error: 'Capability registration requires `name` and `url`.' });
  }

  const normalizedUrl = normalizeUrl(url);
  const existingRecord = serviceRegistryByType.capability.get(name);

  if (existingRecord) {
    unregisterCapabilityAliases(existingRecord);
  }

  const normalizedEndpoints = normalizeEndpoints(endpoints, endpoint || defaultEndpoint);

  const record = {
    name,
    url: normalizedUrl,
    provides: Array.isArray(provides) ? provides : [],
    metadata,
    endpoints: normalizedEndpoints,
    registeredAt: nowIsoString(),
    lastHeartbeat: nowIsoString(),
  };

  serviceRegistryByType.capability.set(name, record);

  record.provides.forEach((alias) => {
    capabilityAliasIndex.set(alias, name);
  });

  console.log(`Capability registered: ${name} at ${normalizedUrl}`);
  res.json({ status: 'registered', capability: record });
});

app.post('/register/device', (req, res) => {
  const { id, name, url, thingDescription, capabilities = [], metadata = {}, uiSchema, defaultPrompt } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: 'Device registration requires `id` and `name`.' });
  }

  const record = {
    id,
    name,
    url: url ? normalizeUrl(url) : undefined,
    thingDescription,
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    metadata,
    uiSchema: uiSchema || metadata.uiSchema || null,
    defaultPrompt: defaultPrompt || metadata.defaultPrompt || null,
    registeredAt: nowIsoString(),
    lastHeartbeat: nowIsoString(),
  };

  deviceRegistry.set(id, record);
  serviceRegistryByType.device.set(id, {
    name: id,
    url: record.url,
    metadata: metadata,
    capabilities: record.capabilities,
    registeredAt: record.registeredAt,
    lastHeartbeat: record.lastHeartbeat,
    type: 'device',
  });
  console.log(`Device registered: ${name} (${id})`);

  generateUiForDevice({ deviceId: id }).catch((error) => {
    console.error(`Failed to generate initial UI for ${id}:`, error.message);
  });

  res.json({ status: 'registered', device: record });
});

app.post('/generate-ui', async (req, res) => {
  const { prompt, schema, deviceId, thingDescription, capabilities, broadcast = true } = req.body;

  console.log(
    `Received UI generation request. Prompt: ${prompt || '[default]'}, Device: ${deviceId || 'none'}, Capabilities: ${JSON.stringify(
      capabilities
    )}`
  );

  try {
    const ui = await generateUiForDevice({
      deviceId,
      prompt,
      schema,
      thingDescription,
      capabilities,
      broadcast,
    });

    res.json({ status: 'UI generated', deviceId: deviceId || null, ui });
  } catch (error) {
    console.error('Error communicating with Requirement Knowledge Base:', error);
    res.status(500).json({ error: 'Failed to generate UI', details: error.message });
  }
});

app.post('/refresh', async (req, res) => {
  const targetDeviceId = req.body?.deviceId;
  const deviceIds = targetDeviceId ? [targetDeviceId] : Array.from(deviceRegistry.keys());

  if (deviceIds.length === 0) {
    return res.status(400).json({ error: 'No devices registered to refresh.' });
  }

  const results = await Promise.allSettled(
    deviceIds.map((id) =>
      generateUiForDevice({ deviceId: id }).then(() => ({ deviceId: id }))
    )
  );

  const successes = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value.deviceId);
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result, index) => ({ deviceId: deviceIds[index], error: result.reason?.message || 'Unknown error' }));

  failures.forEach(({ deviceId, error }) => {
    console.error(`Failed to refresh device ${deviceId}:`, error);
  });

  res.json({ status: 'refresh-complete', successes, failures });
});

wss.on('connection', (ws, request) => {
  let deviceId;

  try {
    const requestUrl = request.url || '';
    const queryString = requestUrl.includes('?') ? requestUrl.split('?')[1] : '';
    const params = new URLSearchParams(queryString);
    deviceId = params.get('deviceId') || undefined;
  } catch (error) {
    console.error('Failed to parse websocket query params:', error);
  }

  if (deviceId) {
    const sockets = ensureSocketSet(deviceId);
    sockets.add(ws);
    ws.deviceId = deviceId;
    console.log(`WebSocket client connected for device ${deviceId}`);
  } else {
    console.log('WebSocket client connected without deviceId; broadcasting mode enabled.');
  }

  ws.send(JSON.stringify({
    deviceId: deviceId || null,
    generatedAt: nowIsoString(),
    ui: {
      type: 'container',
      children: [
        { type: 'text', content: 'Awaiting UI definition from core system…' },
      ],
    },
  }));

  ws.on('close', () => {
    if (ws.deviceId) {
      const sockets = deviceSockets.get(ws.deviceId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          deviceSockets.delete(ws.deviceId);
        }
      }
      console.log(`WebSocket client disconnected for device ${ws.deviceId}`);
    } else {
      console.log('WebSocket client disconnected.');
    }
  });
});

server.listen(port, () => {
  console.log(`UI Generator listening at http://localhost:${port}`);
  registerWithServiceRegistry();
  scheduleDeviceUiRefresh();
});

const registryServer = registryApp.listen(registryPort, () => {
  console.log(`Service registry listening at http://localhost:${registryPort}`);
});

registerService({
  name: 'core-system',
  url: `http://localhost:${port}`,
  metadata: { description: 'Core orchestration service' },
  capabilities: ['uiOrchestration'],
});
