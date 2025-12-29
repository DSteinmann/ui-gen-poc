import express from 'express';
import http from 'http';
import cors from 'cors';
import { 
  PORT, 
  REGISTRY_PORT, 
  CORE_PUBLIC_URL,
  REGISTRY_PUBLIC_URL,
  LISTEN_ADDRESS,
  UI_REFRESH_INTERVAL_MS 
} from './src/config.js';
import { 
  coreRouter, 
  registryRouter 
} from './src/routes.js';
import { 
  initializeWebSocketServer 
} from './src/transport/websocket.js';
import { 
  registerService, 
  onThingRegistered, 
  onServiceRegistered,
  deviceRegistry 
} from './src/services/registry.js';
import { 
  generateUiForDevice, 
  refreshDevicesAssociatedWithThing 
} from './src/services/orchestrator.js';
import { registerActionProvider } from './action-registry.js';
import thingDescriptionActionProvider from './plugins/thing-description-action-provider.js';

// Setup Action Provider
registerActionProvider(thingDescriptionActionProvider);

// Setup Event Listeners
onThingRegistered((record) => {
  setTimeout(() => refreshDevicesAssociatedWithThing(record.id), 0);
});

onServiceRegistered((record) => {
  if (record.name === 'knowledge-base') {
    setTimeout(() => {
      deviceRegistry.forEach((deviceRecord) => {
        generateUiForDevice({ deviceId: deviceRecord.id }).catch((error) => {
          console.error(`Failed to refresh UI for ${deviceRecord.id} after knowledge base registration:`, error.message);
        });
      });
    }, 1000);
  }
});

// Setup Core App
const app = express();
app.use(express.json());
app.use(cors());
app.use('/', coreRouter);

const server = http.createServer(app);
initializeWebSocketServer(server);

// Setup Registry App
const registryApp = express();
registryApp.use(express.json());
registryApp.use(cors());
registryApp.use('/', registryRouter);

// Start Servers
server.listen(PORT, LISTEN_ADDRESS, () => {
  console.log(`UI Generator listening at ${LISTEN_ADDRESS}:${PORT} (public URL: ${CORE_PUBLIC_URL})`);
  
  // Register Self
  try {
    registerService({
      name: 'core-system',
      url: CORE_PUBLIC_URL,
      metadata: { description: 'Core orchestration service' },
      capabilities: ['uiOrchestration'],
    });
    console.log('Registered core-system with internal registry.');
  } catch (err) {
    console.error('Failed to register core-system:', err);
  }

  // Start Schedule
  setInterval(() => {
    deviceRegistry.forEach((record) => {
      generateUiForDevice({ deviceId: record.id }).catch((error) => {
        console.error(`Failed to refresh UI for device ${record.id}:`, error.message);
      });
    });
  }, UI_REFRESH_INTERVAL_MS);
});

registryApp.listen(REGISTRY_PORT, LISTEN_ADDRESS, () => {
  console.log(`Service registry listening at ${LISTEN_ADDRESS}:${REGISTRY_PORT} (public URL: ${REGISTRY_PUBLIC_URL})`);
});
