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

const port = Number.parseInt(process.env.CORE_SYSTEM_PORT || '3001', 10);
const registryPort = Number.parseInt(process.env.SERVICE_REGISTRY_PORT || '3000', 10);
const uiRefreshIntervalMs = 60000;
const fallbackPrompt = 'Generate an adaptive interface for the registered device.';
const corePublicUrl = process.env.CORE_SYSTEM_PUBLIC_URL || `http://localhost:${port}`;
const registryPublicUrl = process.env.SERVICE_REGISTRY_PUBLIC_URL || `http://localhost:${registryPort}`;
const serviceRegistryUrl = process.env.SERVICE_REGISTRY_URL || registryPublicUrl;
const knowledgeBaseUrl = process.env.KNOWLEDGE_BASE_URL || 'http://localhost:3005';
const listenAddress = process.env.BIND_ADDRESS || '0.0.0.0';

const serviceRegistryByType = {
  generic: new Map(),
  capability: new Map(),
  device: new Map(),
};
const capabilityAliasIndex = new Map();
const deviceRegistry = new Map();
const deviceSockets = new Map(); // deviceId -> Set<WebSocket>
const latestUiByDevice = new Map(); // deviceId -> last generated UI definition
const thingRegistry = new Map(); // thingId -> { id, description, metadata, registeredAt }

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
  things: Array.from(thingRegistry.values()).map((thing) => ({
    id: thing.id,
    metadata: thing.metadata,
    registeredAt: thing.registeredAt,
    lastHeartbeat: thing.lastHeartbeat,
  })),
});

const scoreDeviceForCapabilities = (device, desiredCapabilities = []) => {
  if (!device) {
    return { matches: 0, missing: desiredCapabilities.slice(), supportsAll: false };
  }

  const supported = new Set(Array.isArray(device.capabilities) ? device.capabilities : []);
  const missing = [];
  let matches = 0;

  desiredCapabilities.forEach((capability) => {
    if (supported.has(capability)) {
      matches += 1;
    } else {
      missing.push(capability);
    }
  });

  return {
    matches,
    missing,
    supportsAll: missing.length === 0,
  };
};

const selectTargetDevice = ({ requestedDeviceId, desiredCapabilities = [] } = {}) => {
  if (requestedDeviceId) {
    const explicitDevice = deviceRegistry.get(requestedDeviceId);
    return {
      device: explicitDevice || null,
      reason: explicitDevice ? 'explicit-device-request' : 'requested-device-not-found',
      score: scoreDeviceForCapabilities(explicitDevice, desiredCapabilities),
    };
  }

  const devices = Array.from(deviceRegistry.values());
  if (devices.length === 0) {
    return { device: null, reason: 'no-devices-registered', score: scoreDeviceForCapabilities(null, desiredCapabilities) };
  }

  if (!desiredCapabilities || desiredCapabilities.length === 0) {
    return {
      device: devices[0],
      reason: 'no-capabilities-requested',
      score: scoreDeviceForCapabilities(devices[0], desiredCapabilities),
    };
  }

  const ranked = devices
    .map((device) => ({
      device,
      score: scoreDeviceForCapabilities(device, desiredCapabilities),
    }))
    .sort((a, b) => {
      if (a.score.supportsAll && !b.score.supportsAll) return -1;
      if (!a.score.supportsAll && b.score.supportsAll) return 1;
      if (b.score.matches !== a.score.matches) {
        return b.score.matches - a.score.matches;
      }
      return (a.score.missing.length || Infinity) - (b.score.missing.length || Infinity);
    });

  const bestMatch = ranked[0];

  return {
    device: bestMatch?.device || null,
    reason: bestMatch ? 'auto-selected-best-match' : 'no-suitable-device-found',
    score: bestMatch?.score || scoreDeviceForCapabilities(null, desiredCapabilities),
  };
};

const buildDynamicPrompt = ({
  basePrompt,
  targetDevice,
  desiredCapabilities = [],
  selectionReason,
  selectionScore,
}) => {
  const deviceSummaries = Array.from(deviceRegistry.values()).map((device) => {
    const supportedComponents = Array.isArray(device.metadata?.supportedUiComponents)
      ? device.metadata.supportedUiComponents.join(', ')
      : 'unspecified';
    const capabilityList = Array.isArray(device.capabilities) && device.capabilities.length > 0
      ? device.capabilities.join(', ')
      : 'none';

    return `- ${device.name} (${device.id}): capabilities [${capabilityList}], components [${supportedComponents}]`;
  });

  const targetSummary = targetDevice
    ? `${targetDevice.name} (${targetDevice.id})`
    : 'none available';

  const capabilityClause = desiredCapabilities.length > 0
    ? `Requested capabilities: ${desiredCapabilities.join(', ')}.`
    : 'No explicit capability requirements were provided.';

  const selectionClause = selectionReason
    ? `Selection reason: ${selectionReason}${selectionScore?.missing?.length ? ` (missing capabilities: ${selectionScore.missing.join(', ')})` : ''}.`
    : 'Selection reason: not provided.';

  return [
    basePrompt,
    '---',
    'Connected device overview:',
    deviceSummaries.join('\n'),
    capabilityClause,
    `Target device for this UI: ${targetSummary}.`,
    selectionClause,
    'Make sure the generated UI is tailored to the target device and its capabilities.',
  ]
    .filter(Boolean)
    .join('\n\n');
};

const selectDeviceViaKnowledgeBase = async ({
  prompt,
  thingDescription,
  desiredCapabilities = [],
  model,
}) => {
  const candidates = Array.from(deviceRegistry.values());
  if (candidates.length === 0) {
    return null;
  }

  const candidatePayload = candidates.map((device) => {
    const score = scoreDeviceForCapabilities(device, desiredCapabilities);
    return {
      id: device.id,
      name: device.name,
      capabilities: device.capabilities,
      metadata: {
        deviceType: device.metadata?.deviceType,
        supportsAudio: device.metadata?.supportsAudio || false,
        supportsDictation: device.metadata?.supportsDictation || false,
        supportsTouch: device.metadata?.supportsTouch || false,
        supportsTheming: device.metadata?.supportsTheming || [],
        supportedUiComponents: device.metadata?.supportedUiComponents || [],
        modalityPreference: device.metadata?.modalityPreference || null,
      },
      uiSchema: device.uiSchema
        ? {
            components: device.uiSchema.components || {},
            tools: device.uiSchema.tools || {},
            theming: device.uiSchema.theming || null,
            context: device.uiSchema.context || null,
          }
        : null,
      defaultPrompt: device.defaultPrompt,
      score,
    };
  });

  const payload = {
    prompt,
    fallbackPrompt,
    desiredCapabilities,
    thingDescription,
    candidates: candidatePayload,
    model,
  };

  try {
  const response = await fetch(`${knowledgeBaseUrl}/select-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Core] Knowledge base device selection failed with status ${response.status}: ${errorText}`);
      return null;
    }

    const selection = await response.json();
    if (!selection?.targetDeviceId) {
      console.warn('[Core] Knowledge base device selection returned no targetDeviceId.');
      return null;
    }

    if (!deviceRegistry.has(selection.targetDeviceId)) {
      console.warn(`[Core] Knowledge base selected unknown device '${selection.targetDeviceId}'.`);
      return null;
    }

    return {
      deviceId: selection.targetDeviceId,
      reason: selection.reason || 'knowledge-base-selected-device',
      confidence: selection.confidence || 'unknown',
      alternateDeviceIds: Array.isArray(selection.alternateDeviceIds) ? selection.alternateDeviceIds : [],
      raw: selection,
    };
  } catch (error) {
    console.error('[Core] Device selection via knowledge base failed:', error.message);
    return null;
  }
};

const registerWithServiceRegistry = async () => {
  try {
    await fetch(`${serviceRegistryUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'core-system',
        url: corePublicUrl,
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
  if (deviceId) {
    latestUiByDevice.set(deviceId, uiDefinition);
  }

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
    } else {
      console.log(`[Core] Cached UI for device '${deviceId}' until a socket connects.`);
    }
    return;
  }

  // Broadcast payload to any connected socket when no specific device target is provided.
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
  model,
}) => {
  const requestedCapabilities = Array.isArray(capabilities) ? capabilities.filter(Boolean) : [];

  const basePrompt = prompt || fallbackPrompt;
  let targetDeviceId = deviceId || null;
  let selectionMeta = null;

  if (!targetDeviceId) {
    if (deviceRegistry.size === 1) {
      const soleDevice = deviceRegistry.values().next().value;
      targetDeviceId = soleDevice?.id || null;
      selectionMeta = {
        deviceId: targetDeviceId,
        reason: 'only-device-available',
        confidence: 'high',
        alternateDeviceIds: [],
        raw: { soleDevice: true },
        score: scoreDeviceForCapabilities(soleDevice, requestedCapabilities),
      };
    } else {
      selectionMeta = await selectDeviceViaKnowledgeBase({
        prompt: basePrompt,
        thingDescription,
        desiredCapabilities: requestedCapabilities,
        model,
      });

      if (!selectionMeta || !selectionMeta.deviceId) {
        console.warn('[Core] Falling back to heuristic device selection.');
        const heuristic = selectTargetDevice({ desiredCapabilities: requestedCapabilities });
        targetDeviceId = heuristic.device?.id || null;
        selectionMeta = {
          deviceId: targetDeviceId,
          reason: heuristic.reason,
          confidence: 'heuristic',
          alternateDeviceIds: [],
          raw: { heuristic: true },
          score: heuristic.score,
        };
      } else {
        targetDeviceId = selectionMeta.deviceId;
      }
    }
  }

  if (!targetDeviceId) {
    throw new Error('No suitable device available for UI generation.');
  }

  const targetDevice = deviceRegistry.get(targetDeviceId);

  if (!targetDevice) {
    throw new Error(`Unknown device '${targetDeviceId}'.`);
  }

  if (!selectionMeta) {
    selectionMeta = {
      deviceId: targetDeviceId,
      reason: 'explicit-device-request',
      confidence: 'certain',
      alternateDeviceIds: [],
      raw: { explicit: true },
    };
  }

  const selectionScore = scoreDeviceForCapabilities(targetDevice, requestedCapabilities);
  selectionMeta.score = selectionScore;

  const resolvedCapabilities = requestedCapabilities.length > 0
    ? requestedCapabilities
    : Array.isArray(targetDevice.capabilities)
      ? targetDevice.capabilities
      : [];

  const basePromptForUi = prompt || targetDevice?.defaultPrompt || fallbackPrompt;
  const resolvedPrompt = buildDynamicPrompt({
    basePrompt: basePromptForUi,
    targetDevice,
    desiredCapabilities: resolvedCapabilities,
    selectionReason: selectionMeta.reason,
    selectionScore,
  });

  const resolvedSchema = schema && Object.keys(schema).length > 0
    ? schema
    : targetDevice?.uiSchema
      ? { ...targetDevice.uiSchema }
      : { components: {} };

  if (!resolvedSchema.name) {
    resolvedSchema.name = targetDevice.id;
  }

  let resolvedThingDescription = thingDescription || null;
  if (!resolvedThingDescription && targetDevice?.thingDescription) {
    resolvedThingDescription = targetDevice.thingDescription;
  }
  if (!resolvedThingDescription && targetDevice?.thingId) {
    const registeredThing = thingRegistry.get(targetDevice.thingId);
    if (registeredThing && registeredThing.description) {
      resolvedThingDescription = registeredThing.description;
    }
  }

  const { capabilityData, missingCapabilities } = await collectCapabilityData(resolvedCapabilities, {
    prompt: resolvedPrompt,
    deviceId: targetDeviceId,
    device: targetDevice,
  });

  const toolConfig = (targetDevice?.uiSchema && typeof targetDevice.uiSchema === 'object') ? targetDevice.uiSchema.tools || {} : {};
  const capabilityToolHints = {};
  Object.entries(toolConfig).forEach(([toolName, config]) => {
    if (config && typeof config === 'object') {
      const capabilityKey = config.capability || config.capabilityAlias || config.provides;
      if (capabilityKey) {
        capabilityToolHints[capabilityKey] = toolName;
      }
    }
  });

  const sanitizedCapabilityData = {};
  Object.entries(capabilityData).forEach(([capabilityName, details]) => {
    const toolName = capabilityToolHints[capabilityName];
    if (toolName) {
      sanitizedCapabilityData[capabilityName] = {
        note: `Use tool '${toolName}' to retrieve the latest data for capability '${capabilityName}'.`,
        ...(details?.error ? { error: details.error } : {}),
        ...(details?.data !== undefined ? { cachedSample: details.data } : {}),
      };
    } else {
      sanitizedCapabilityData[capabilityName] = details;
    }
  });

  const knowledgeBasePayload = {
    prompt: resolvedPrompt,
    schema: resolvedSchema,
    thingDescription: resolvedThingDescription,
    capabilities: resolvedCapabilities,
    capabilityData: sanitizedCapabilityData,
    missingCapabilities,
    deviceId: targetDeviceId,
    device: targetDevice,
    selection: {
      reason: selectionMeta.reason,
      score: selectionMeta.score,
      confidence: selectionMeta.confidence,
      alternateDeviceIds: selectionMeta.alternateDeviceIds,
      consideredDevices: Array.from(deviceRegistry.keys()),
      raw: selectionMeta.raw,
      targetDeviceId,
    },
  };

  console.log(`[Core] Generating UI for device '${targetDeviceId}' with capabilities: ${resolvedCapabilities.join(', ') || 'none'} (reason: ${selectionMeta.reason})`);

  let requirementKnowledgeBaseResponse;
  try {
  requirementKnowledgeBaseResponse = await fetch(`${knowledgeBaseUrl}/query`, {
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
    dispatchUiToClients(targetDeviceId, generatedUi);
    console.log(`[Core] Dispatched UI to device '${targetDeviceId}'.`);
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

const registerService = ({
  name,
  url,
  metadata = {},
  capabilities = [],
  type = 'generic',
  endpoints,
  provides,
}) => {
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
    metadata: Object.keys(metadata).length > 0 ? metadata : existing?.metadata || {},
    capabilities: Array.isArray(capabilities) && capabilities.length > 0
      ? capabilities
      : existing?.capabilities || [],
    registeredAt: existing?.registeredAt || now,
    lastHeartbeat: now,
    type,
  };

  if (type === 'capability') {
    const resolvedProvides = Array.isArray(provides) && provides.length > 0
      ? provides
      : Array.isArray(existing?.provides) ? existing.provides : [];

    record.provides = resolvedProvides;

    const resolvedEndpoints = endpoints && Object.keys(endpoints).length > 0
      ? endpoints
      : existing?.endpoints || {};

    record.endpoints = resolvedEndpoints;
  }

  registry.set(name, record);

  if (name === 'knowledge-base') {
    setTimeout(() => {
      deviceRegistry.forEach((deviceRecord) => {
        generateUiForDevice({ deviceId: deviceRecord.id }).catch((error) => {
          console.error(`Failed to refresh UI for ${deviceRecord.id} after knowledge base registration:`, error.message);
        });
      });
    }, 1000);
  }

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

app.post('/register/thing', (req, res) => {
  const { id, description, metadata = {}, lastHeartbeat } = req.body || {};

  if (!id || !description) {
    return res.status(400).json({ error: 'Thing registration requires `id` and `description`.' });
  }

  const record = {
    id,
    description,
    metadata,
    registeredAt: nowIsoString(),
    lastHeartbeat: lastHeartbeat || nowIsoString(),
  };

  thingRegistry.set(id, record);
  console.log(`Thing registered: ${id}`);
  res.json({ status: 'registered', thing: record });
});

app.post('/register/device', (req, res) => {
  const { id, name, url, thingId, thingDescription, capabilities = [], metadata = {}, uiSchema, defaultPrompt } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: 'Device registration requires `id` and `name`.' });
  }

  const record = {
    id,
    name,
    url: url ? normalizeUrl(url) : undefined,
    thingDescription,
    thingId,
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
  const { prompt, schema, deviceId, thingDescription, capabilities, broadcast = true, model } = req.body;

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
      model,
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

  const initialUi = deviceId ? latestUiByDevice.get(deviceId) : null;
  const payload = {
    deviceId: deviceId || null,
    generatedAt: nowIsoString(),
    ui: initialUi || {
      type: 'container',
      children: [
        { type: 'text', content: 'Awaiting UI definition from core system…' },
      ],
    },
  };

  if (deviceId && initialUi) {
    console.log(`[Core] Delivered cached UI to device '${deviceId}' on socket connect.`);
  }

  ws.send(JSON.stringify(payload));

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

server.listen(port, listenAddress, () => {
  console.log(`UI Generator listening at ${listenAddress}:${port} (public URL: ${corePublicUrl})`);
  registerWithServiceRegistry();
  scheduleDeviceUiRefresh();
});

const registryServer = registryApp.listen(registryPort, listenAddress, () => {
  console.log(`Service registry listening at ${listenAddress}:${registryPort} (public URL: ${registryPublicUrl})`);
});

registerService({
  name: 'core-system',
  url: corePublicUrl,
  metadata: { description: 'Core orchestration service' },
  capabilities: ['uiOrchestration'],
});
