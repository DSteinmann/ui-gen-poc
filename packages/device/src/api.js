import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = Number.parseInt(process.env.DEVICE_API_PORT || '3002', 10);
const listenAddress = process.env.BIND_ADDRESS || '0.0.0.0';
const serviceRegistryUrl = process.env.SERVICE_REGISTRY_URL || 'http://localhost:3000';
const coreSystemUrl = process.env.CORE_SYSTEM_URL || 'http://localhost:3001';
const devicePublicUrl = process.env.DEVICE_API_PUBLIC_URL || `http://localhost:${port}`;

app.use(express.json());

const deviceId = 'device-smartphone-001';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, '..', 'schema.json');
const uiSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

const registerWithServiceRegistry = async () => {
  try {
    await fetch(`${serviceRegistryUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'smartphone-device',
        url: devicePublicUrl,
        type: 'device',
        metadata: {
          deviceId,
          deviceType: 'smartphone',
        },
      })
    });
    console.log('Registered device service with registry');
  } catch (error) {
    console.error('Error registering device with service registry:', error);
  }
};

const registerWithCoreSystem = async () => {
  const supportedComponents = Object.keys(uiSchema.components || {});
  const supportsTheming = uiSchema.theming?.supportsPrimaryColor ? ['theme.primaryColor'] : [];

  const deviceRegistrationPayload = {
    id: deviceId,
    name: 'Smartphone Controller',
    url: devicePublicUrl,
    thingId: 'thing-light-switch-001',
    capabilities: [],
    metadata: {
      deviceType: 'smartphone',
      supportedUiComponents: supportedComponents,
      supportsAudio: false,
      supportsTouch: true,
      supportsTheming: supportsTheming,
      uiSchema,
    },
    uiSchema,
  };

  try {
    await fetch(`${coreSystemUrl}/register/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deviceRegistrationPayload),
    });
    console.log('Registered smartphone with core system');
  } catch (error) {
    console.error('Error registering device with core system:', error);
  }
};

app.post('/api/call-tool', (req, res) => {
  const { toolName } = req.body;

  if (toolName === 'getAmbientLight') {
    console.log('getAmbientLight tool called');
    res.json({ result: 'dark' });
  } else {
    console.log('Unknown tool called');
    res.status(400).json({ error: 'Unknown tool' });
  }
});

app.listen(port, listenAddress, () => {
  console.log(`Smartphone device service listening at ${listenAddress}:${port} (public URL: ${devicePublicUrl})`);
  registerWithServiceRegistry();
  registerWithCoreSystem();
});
