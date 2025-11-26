import express from 'express';
import fetch from 'node-fetch';

const app = express();
const port = Number.parseInt(process.env.THINGS_PORT || '3006', 10);
const listenAddress = process.env.BIND_ADDRESS || '0.0.0.0';
const serviceRegistryUrl = process.env.SERVICE_REGISTRY_URL || 'http://core-system:3000';
const coreSystemUrl = process.env.CORE_SYSTEM_URL || 'http://core-system:3001';
const thingsPublicUrl = process.env.THINGS_PUBLIC_URL || `http://things:${port}`;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'things' });
});

const lightSwitchThingId = 'thing-light-switch-001';
const lightSwitchThingUrn = 'urn:uuid:7e3a3d1b-7a52-49df-af9a-7077b4f96942';
const tractorThingId = 'thing-tractorbot-spock';
const tractorThingUrn = 'urn:tractorbot_spock';

const tractorBasePath = '/tractorbot';
const tractorBaseUrl = `${thingsPublicUrl}${tractorBasePath}`;

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
          metadata: {
            capability: 'lighting',
            scope: 'device',
            intentAliases: ['lights.turnon', 'lights.on', 'switch.on'],
          },
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
          metadata: {
            capability: 'lighting',
            scope: 'device',
            intentAliases: ['lights.turnoff', 'lights.off', 'lights.off.all', 'quickalloff'],
          },
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
          metadata: {
            capability: 'lighting',
            scope: 'device',
            intentAliases: ['lights.toggle', 'switch.toggle'],
          },
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
  {
    id: tractorThingId,
    description: {
      '@context': [
        'https://www.w3.org/2019/wot/td/v1',
        { '@language': 'en', schema: 'https://schema.org/' },
      ],
      '@type': ['Thing', 'http://semantics.interactions.ics.unisg.ch/hackathon21#Robot'],
      id: tractorThingUrn,
      title: 'Smart tractor',
      description: 'Autonomous mecanum-wheel tractor with LiDAR and soil sensing.',
      base: tractorBaseUrl,
      securityDefinitions: {
        nosec_sc: { scheme: 'nosec' },
      },
      security: ['nosec_sc'],
      properties: {
        batteryLevel: {
          title: 'Battery Voltage',
          type: 'array',
          items: { type: 'number' },
          observable: false,
          forms: [
            {
              href: '/properties/batteryvoltage',
              op: ['readproperty'],
              contentType: 'application/json',
              method: 'GET',
            },
          ],
        },
        lidar: {
          title: 'LiDAR distances',
          type: 'array',
          items: { type: 'number' },
          observable: false,
          forms: [
            {
              href: '/properties/lidar',
              op: ['readproperty'],
              contentType: 'application/json',
              method: 'GET',
            },
          ],
        },
        soilCondition: {
          title: 'Soil Condition',
          type: 'array',
          items: { type: 'number' },
          observable: false,
          forms: [
            {
              href: '/properties/soilcondition',
              op: ['readproperty'],
              contentType: 'application/json',
              method: 'GET',
            },
          ],
        },
        highTemperature: {
          title: 'High Temperature Threshold',
          type: 'number',
          observable: true,
          forms: [
            {
              href: '/events/hightemperature',
              op: ['readproperty'],
              contentType: 'application/json',
              method: 'GET',
            },
            {
              href: '/events/hightemperature',
              op: ['writeproperty'],
              contentType: 'application/json',
              method: 'POST',
            },
          ],
        },
        lowBattery: {
          title: 'Low Battery Threshold',
          type: 'number',
          observable: true,
          forms: [
            {
              href: '/events/lowbattery',
              op: ['readproperty'],
              contentType: 'application/json',
              method: 'GET',
            },
            {
              href: '/events/lowbattery',
              op: ['writeproperty'],
              contentType: 'application/json',
              method: 'POST',
            },
          ],
        },
      },
      actions: {
        setWheelControl: {
          description: 'Drive mecanum wheels with axis/speed/duration payload.',
          metadata: {
            capability: 'mobility.drive',
            scope: 'device',
            intentAliases: ['tractor.drive', 'tractor.move', 'mobility.drive'],
          },
          forms: [
            {
              href: '/actions/wheelControl',
              op: ['invokeaction'],
              method: 'POST',
              contentType: 'application/json',
            },
          ],
          input: {
            type: 'object',
            properties: {
              duration: { type: 'integer', minimum: 0, maximum: 20000 },
              axis: { type: 'integer', minimum: 0, maximum: 2 },
              speed: { type: 'integer', minimum: -7, maximum: 7 },
            },
          },
        },
      },
    },
    metadata: {
      deviceType: 'tractorbot',
      location: 'field.alpha',
      manufacturer: 'TractorBots Inc.',
      model: 'Spock',
      serialNumber: 'TRAC-042',
      firmwareVersion: '0.9.1',
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

let tractorBatteryVoltage = [72.1, 71.9, 71.5];
let tractorLidarSample = [4.2, 3.9, 2.8, 6.1, 3.7];
let tractorSoilMoisture = [28, 31, 27];
let tractorHighTempThreshold = 85;
let tractorLowBatteryThreshold = 25;

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

const resolveBaseTractorResponse = () => ({
  timestamp: new Date().toISOString(),
  id: tractorThingId,
});

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

app.get(`${tractorBasePath}/properties/batteryvoltage`, (_req, res) => {
  console.log('[Things] Tractor battery voltage read.');
  res.json({
    values: tractorBatteryVoltage,
    unit: 'V',
    variance: 0.4,
    ...resolveBaseTractorResponse(),
  });
});

app.get(`${tractorBasePath}/properties/lidar`, (_req, res) => {
  console.log('[Things] Tractor LiDAR sample read.');
  res.json({
    distances: tractorLidarSample,
    units: 'm',
    sweep: 'front-arc',
    ...resolveBaseTractorResponse(),
  });
});

app.get(`${tractorBasePath}/properties/soilcondition`, (_req, res) => {
  console.log('[Things] Tractor soil condition read.');
  res.json({
    moisture: tractorSoilMoisture,
    unit: '%',
    description: 'Topsoil moisture samples across chassis sensors.',
    ...resolveBaseTractorResponse(),
  });
});

app.get(`${tractorBasePath}/events/hightemperature`, (_req, res) => {
  res.json({ threshold: tractorHighTempThreshold, unit: '°C', ...resolveBaseTractorResponse() });
});

app.post(`${tractorBasePath}/events/hightemperature`, (req, res) => {
  const { threshold } = req.body || {};
  if (typeof threshold !== 'number') {
    return res.status(400).json({ error: 'Threshold must be numeric.' });
  }
  tractorHighTempThreshold = threshold;
  res.json({ status: 'updated', threshold, ...resolveBaseTractorResponse() });
});

app.get(`${tractorBasePath}/events/lowbattery`, (_req, res) => {
  res.json({ percentage: tractorLowBatteryThreshold, unit: '%', ...resolveBaseTractorResponse() });
});

app.post(`${tractorBasePath}/events/lowbattery`, (req, res) => {
  const { percentage } = req.body || {};
  if (typeof percentage !== 'number') {
    return res.status(400).json({ error: 'Percentage must be numeric.' });
  }
  tractorLowBatteryThreshold = percentage;
  res.json({ status: 'updated', percentage, ...resolveBaseTractorResponse() });
});

app.post(`${tractorBasePath}/actions/wheelControl`, (req, res) => {
  const { duration = 0, axis = 0, speed = 0 } = req.body || {};
  if (typeof duration !== 'number' || duration < 0 || duration > 20000) {
    return res.status(400).json({ error: 'Duration must be between 0 and 20000 milliseconds.' });
  }
  if (typeof axis !== 'number' || axis < 0 || axis > 2) {
    return res.status(400).json({ error: 'Axis must be 0, 1, or 2.' });
  }
  if (typeof speed !== 'number' || speed < -7 || speed > 7) {
    return res.status(400).json({ error: 'Speed must be between -7 and 7.' });
  }

  const direction = axis === 0 ? 'lateral' : axis === 1 ? 'forward' : 'rotation';
  console.log(`[Things] Wheel control invoked: axis=${axis} (${direction}), speed=${speed}, duration=${duration}ms`);

  res.json({
    status: 'accepted',
    axis,
    speed,
    duration,
    direction,
    completedAt: new Date(Date.now() + duration).toISOString(),
    ...resolveBaseTractorResponse(),
  });
});

app.listen(port, listenAddress, () => {
  console.log(`[Things] Service listening at ${listenAddress}:${port} (public URL: ${thingsPublicUrl})`);
  registerWithServiceRegistry();
  registerThingsWithCore();
});
