import express from 'express';
import fetch from 'node-fetch';

const app = express();
const port = 3002;

app.use(express.json());

const deviceId = 'device-smartphone-001';

const registerWithServiceRegistry = async () => {
  try {
    await fetch('http://localhost:3000/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'smartphone-device',
        url: `http://localhost:${port}`,
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

const deviceThingDescription = {
  title: 'GenUI Light Switch Controller',
  description: 'Smartphone-based UI to control a networked light switch.',
  properties: {
    status: {
      type: 'string',
      enum: ['on', 'off'],
      description: 'Current state of the controlled light switch.',
    },
  },
  actions: {
    turnOn: {
      description: 'Turn the light switch on.',
    },
    turnOff: {
      description: 'Turn the light switch off.',
    },
    toggle: {
      description: 'Toggle the light switch state.',
    },
  },
  uiModalities: ['visual', 'audio'],
};

const defaultPrompt = 'Provide controls for a connected light switch including status feedback. When the user activity sensor reports hands-occupied, switch to audio guidance. Otherwise render touch-friendly controls. If the requirement knowledge base includes a preferred primary color, set the UI theme.primaryColor to that value so the interface is personalized.';

const uiSchema = {
  name: 'smartphone-light-switch-ui',
  components: {
    text: { description: 'Status text block.' },
    button: { description: 'Action button triggering remote actions.' },
    toggle: { description: 'Switch element representing light state.' },
    speak: { description: 'Audio output prompt for hands-busy scenarios.' },
  },
  theming: {
    description: 'Supports root `theme.primaryColor` (hex color) for accent styling.',
    supportsPrimaryColor: true,
    defaultPrimaryColor: '#1f6feb',
  },
  context: {
    controlledThing: 'light-switch',
    modalityPreference: 'visual-first',
  },
};

const registerWithCoreSystem = async () => {
  const deviceRegistrationPayload = {
    id: deviceId,
    name: 'Smartphone Controller',
    url: `http://localhost:${port}`,
    thingDescription: deviceThingDescription,
    capabilities: ['userActivity'],
    metadata: {
      deviceType: 'smartphone',
      supportedUiComponents: ['text', 'button', 'toggle', 'speak'],
      supportsAudio: true,
      supportsTouch: true,
      supportsTheming: ['theme.primaryColor'],
      defaultPrompt,
      uiSchema,
    },
    defaultPrompt,
    uiSchema,
  };

  try {
    await fetch('http://localhost:3001/register/device', {
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

app.listen(port, () => {
  console.log(`Smartphone device service listening at http://localhost:${port}`);
  registerWithServiceRegistry();
  registerWithCoreSystem();
});
