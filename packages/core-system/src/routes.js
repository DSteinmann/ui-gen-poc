import express from 'express';
import {
  registerService,
  registerThing,
  registerDevice,
  registrySnapshot,
  findService,
  serviceRegistryByType
} from './services/registry.js';
import { generateUiForDevice } from './services/orchestrator.js';
import { getActionsForThing, getActionById } from '../action-registry.js';
import { nowIsoString } from './utils.js';
import { deviceRegistry } from './services/registry.js'; // Need to access device registry for some /refresh logic

export const coreRouter = express.Router();
export const registryRouter = express.Router();

// --- Core Router (Port 3001) ---

coreRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: nowIsoString(), registeredDevices: deviceRegistry.size });
});

coreRouter.get('/', (_req, res) => {
  res.send('UI Generator');
});

coreRouter.get('/registry', (_req, res) => {
  res.json(registrySnapshot());
});

coreRouter.get('/things/:thingId/actions', (req, res) => {
  const { thingId } = req.params;
  const actions = getActionsForThing(thingId) || [];
  res.json({ thingId, count: actions.length, actions });
});

coreRouter.get('/actions/:actionId', (req, res) => {
  const actionId = decodeURIComponent(req.params.actionId);
  const action = getActionById(actionId);
  if (!action) {
    return res.status(404).json({ error: `Action '${actionId}' not found.` });
  }
  res.json({ action });
});

coreRouter.post('/register/capability', (req, res) => {
  try {
    const record = registerService({ ...req.body, type: 'capability' });
    console.log(`Capability registered: ${record.name} at ${record.url}`);
    res.json({ status: 'registered', capability: record });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

coreRouter.post('/register/thing', (req, res) => {
  try {
    const record = registerThing(req.body || {});
    console.log(`Thing registered: ${record.id}`);
    
    // We handle the refresh side-effect via event listeners in logic layer now, 
    // or we can invoke orchestrator logic if needed. 
    // The previous implementation had `setTimeout(() => refreshDevicesAssociatedWithThing(id), 0);`
    // We moved this logic to event listeners in index.js wiring or orchestrator init.
    
    res.json({ status: 'registered', thing: record });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

coreRouter.post('/register/device', (req, res) => {
  try {
    const record = registerDevice(req.body);
    console.log(`Device registered: ${record.name} (${record.id})`);
    
    // Trigger initial UI generation
    generateUiForDevice({ deviceId: record.id }).catch((error) => {
      console.error(`Failed to generate initial UI for ${record.id}:`, error.message);
    });

    res.json({ status: 'registered', device: record });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

coreRouter.post('/generate-ui', async (req, res) => {
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

coreRouter.post('/refresh', async (req, res) => {
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


// --- Registry Router (Port 3000) ---

registryRouter.post('/register', (req, res) => {
  try {
    const record = registerService(req.body || {});
    console.log(`Service registry: registered ${record.name} at ${record.url}`);
    res.json({ status: 'registered', service: record });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

registryRouter.get('/services/:name', (req, res) => {
  const service = findService(req.params.name);
  if (!service) {
    return res.status(404).json({ error: `Service '${req.params.name}' not found.` });
  }
  res.json(service);
});

registryRouter.get('/services', (_req, res) => {
  res.json({
    services: Array.from(serviceRegistryByType.generic.values()),
    capabilities: Array.from(serviceRegistryByType.capability.values()),
    devices: Array.from(serviceRegistryByType.device.values()),
  });
});
