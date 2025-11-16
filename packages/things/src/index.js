import express from 'express';
import fetch from 'node-fetch';

const app = express();
const port = Number.parseInt(process.env.THINGS_PORT || '3006', 10);
const listenAddress = process.env.BIND_ADDRESS || '0.0.0.0';
const serviceRegistryUrl = process.env.SERVICE_REGISTRY_URL || 'http://localhost:3000';
const coreSystemUrl = process.env.CORE_SYSTEM_URL || 'http://localhost:3001';
const thingsPublicUrl = process.env.THINGS_PUBLIC_URL || `http://localhost:${port}`;

app.use(express.json());

const lightSwitchThingId = 'thing-light-switch-001';
const lightSwitchThingUrn = 'urn:uuid:7e3a3d1b-7a52-49df-af9a-7077b4f96942';

const things = [
  {
    id: lightSwitchThingId,
    description: {
      '@context': [
        'https://www.w3.org/2019/wot/td/v1',
        {
          '@language': 'en',
          schema: 'https://schema.org/',
        },
      ],
      '@type': ['Thing', 'schema:Switch'],
      id: lightSwitchThingUrn,
      title: 'Living Room Light Switch',
      titles: {
        en: 'Living Room Light Switch',
      },
      description: 'Mains-powered smart switch controlling the living room ceiling lighting circuit.',
      descriptions: {
        en: 'Mains-powered smart switch controlling the living room ceiling lighting circuit.',
      },
      base: `${thingsPublicUrl}/light-switch`,
      securityDefinitions: {
        nosec_sc: {
          scheme: 'nosec',
        },
      },
      security: ['nosec_sc'],
      properties: {
        status: {
          title: 'Switch Status',
          description: 'Current on/off state of the light circuit.',
          type: 'string',
          enum: ['on', 'off'],
          observable: true,
          forms: [
            {
              href: '/status',
              op: ['readproperty'],
              contentType: 'application/json',
              method: 'GET',
            },
            {
              href: '/status',
              op: ['writeproperty'],
              contentType: 'application/json',
              method: 'PUT',
            },
          ],
        },
      },
      actions: {
        turnOn: {
          description: 'Energize the light circuit.',
          forms: [
            {
              href: '/actions/turnOn',
              op: ['invokeaction'],
              contentType: 'application/json',
              method: 'POST',
            },
          ],
        },
        turnOff: {
          description: 'De-energize the light circuit.',
          forms: [
            {
              href: '/actions/turnOff',
              op: ['invokeaction'],
              contentType: 'application/json',
              method: 'POST',
            },
          ],
        },
        toggle: {
          description: 'Toggle the light circuit between on and off.',
          forms: [
            {
              href: '/actions/toggle',
              op: ['invokeaction'],
              contentType: 'application/json',
              method: 'POST',
            },
          ],
        },
      },
      links: [
        {
          rel: 'alternate',
          href: 'https://acme.example/products/als-200/manual',
          type: 'text/html',
        },
      ],
    },
    metadata: {
      deviceType: 'light-switch',
      location: 'building.living_room',
      manufacturer: 'Acme Lighting',
      model: 'ALS-200',
      serialNumber: 'ALS200-001',
      firmwareVersion: '1.2.3',
    },
  },
];

const registerWithServiceRegistry = async () => {
  try {
    await fetch(`${serviceRegistryUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'thing-descriptions',
        url: thingsPublicUrl,
        type: 'generic',
        metadata: {
          category: 'thing-descriptions',
        },
      }),
    });
    console.log('[Things] Registered with service registry');
  } catch (error) {
    console.error('[Things] Failed to register with service registry:', error.message);
  }
};

const registerThingsWithCore = async () => {
  for (const thing of things) {
    try {
      await fetch(`${coreSystemUrl}/register/thing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: thing.id,
          description: thing.description,
          metadata: thing.metadata,
        }),
      });
      console.log(`[Things] Registered thing '${thing.id}' with core system`);
    } catch (error) {
      console.error(`[Things] Failed to register thing '${thing.id}':`, error.message);
    }
  }
};

const LIGHT_SWITCH_STATES = ['on', 'off'];
let lightSwitchState = 'off';

const isValidLightSwitchState = (value) => LIGHT_SWITCH_STATES.includes(value);

const buildLightSwitchStatusPayload = () => ({
  status: lightSwitchState,
  timestamp: new Date().toISOString(),
});

const applyLightSwitchState = (nextState, reason) => {
  const previousState = lightSwitchState;
  lightSwitchState = nextState;

  console.log(`[Things] Light switch request '${reason}': ${previousState} -> ${nextState}`);

  return {
    previousState,
    ...buildLightSwitchStatusPayload(),
  };
};

app.get('/things', (_req, res) => {
  res.json({ things });
});

app.get('/things/:id', (req, res) => {
  const thing = things.find((entry) => entry.id === req.params.id);
  if (!thing) {
    return res.status(404).json({ error: `Thing '${req.params.id}' not found.` });
  }
  res.json(thing);
});

app.get('/light-switch/status', (_req, res) => {
  console.log('[Things] Status read request received.');
  res.json(buildLightSwitchStatusPayload());
});

app.put('/light-switch/status', (req, res) => {
  const { status } = req.body || {};

  if (!isValidLightSwitchState(status)) {
    return res.status(400).json({ error: "Status must be either 'on' or 'off'." });
  }

  const payload = applyLightSwitchState(status, 'property.write');
  res.json({ message: `Status set to '${status}'.`, ...payload });
});

app.post('/light-switch/actions/turnOn', (_req, res) => {
  const payload = applyLightSwitchState('on', 'action.turnOn');
  res.json({ message: 'Turn on invoked.', ...payload });
});

app.post('/light-switch/actions/turnOff', (_req, res) => {
  const payload = applyLightSwitchState('off', 'action.turnOff');
  res.json({ message: 'Turn off invoked.', ...payload });
});

app.post('/light-switch/actions/toggle', (_req, res) => {
  const nextState = lightSwitchState === 'on' ? 'off' : 'on';
  const payload = applyLightSwitchState(nextState, 'action.toggle');
  res.json({ message: `Toggle invoked, new state '${nextState}'.`, ...payload });
});

app.listen(port, listenAddress, () => {
  console.log(`[Things] Service listening at ${listenAddress}:${port} (public URL: ${thingsPublicUrl})`);
  registerWithServiceRegistry();
  registerThingsWithCore();
});
