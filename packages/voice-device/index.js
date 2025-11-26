import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = Number.parseInt(process.env.VOICE_DEVICE_PORT || '3004', 10);
const listenAddress = process.env.BIND_ADDRESS || '0.0.0.0';
const serviceRegistryUrl = process.env.SERVICE_REGISTRY_URL || 'http://core-system:3000';
const coreSystemUrl = process.env.CORE_SYSTEM_URL || 'http://core-system:3001';
const devicePublicUrl = process.env.VOICE_DEVICE_PUBLIC_URL || `http://voice-device:${port}`;
const thingsBaseUrl = process.env.LIGHT_SWITCH_BASE_URL || 'http://things:3006/light-switch';
const recognitionLanguage = process.env.VOICE_DEVICE_LANG || 'en-US';

const deriveCoreWebsocketUrl = () => {
  if (process.env.CORE_SYSTEM_WS_URL) {
    return process.env.CORE_SYSTEM_WS_URL;
  }

  try {
    const parsed = new URL(coreSystemUrl);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return parsed.toString();
  } catch (error) {
    console.warn('[Voice Device] Failed to derive core websocket URL from CORE_SYSTEM_URL, defaulting to ws://core-system:3001');
    return 'ws://core-system:3001';
  }
};

const coreWebsocketUrl = deriveCoreWebsocketUrl();

const deviceId = process.env.VOICE_DEVICE_ID || 'device-voice-headset-001';
const deviceName = process.env.VOICE_DEVICE_NAME || 'Hands-free Voice Controller';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const lightSwitchEndpoints = {
  status: `${thingsBaseUrl}/status`,
  turnOn: `${thingsBaseUrl}/actions/turnOn`,
  turnOff: `${thingsBaseUrl}/actions/turnOff`,
  toggle: `${thingsBaseUrl}/actions/toggle`,
};

app.use(express.json());
app.use(express.static(publicDir));

const mapTranscriptToAction = (transcript) => {
  const text = (transcript || '').toLowerCase();
  if (!text.trim()) {
    return null;
  }

  const actionMatchers = [
    { action: 'turnOn', patterns: [/turn\s+on/, /switch\s+on/, /lights?\s+on/, /power\s+on/] },
    { action: 'turnOff', patterns: [/turn\s+off/, /switch\s+off/, /lights?\s+off/, /power\s+off/, /shut\s+down/] },
    { action: 'toggle', patterns: [/toggle/, /swap/, /flip/, /change\s+state/] },
    { action: 'status', patterns: [/status/, /state/, /condition/, /check/, /is\s+the\s+light/] },
  ];

  for (const matcher of actionMatchers) {
    if (matcher.patterns.some((pattern) => pattern.test(text))) {
      return matcher.action;
    }
  }

  return null;
};

const callLightSwitchEndpoint = async (action) => {
  const endpoint = lightSwitchEndpoints[action];
  if (!endpoint) {
    throw new Error(`No endpoint configured for action '${action}'.`);
  }

  const requestInit = {
    method: action === 'status' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
  };

  if (requestInit.method === 'POST') {
    requestInit.body = JSON.stringify({});
  }

  const response = await fetch(endpoint, requestInit);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Endpoint ${endpoint} responded with ${response.status}. Body: ${body}`);
  }

  const payload = await response.json().catch(() => ({}));
  return payload;
};

const registerWithServiceRegistry = async () => {
  try {
    await fetch(`${serviceRegistryUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'voice-device',
        url: devicePublicUrl,
        type: 'device',
        metadata: {
          deviceId,
          deviceType: 'voice-headset',
          modalityPreference: 'audio-first',
        },
      }),
    });
    console.log('[Voice Device] Registered with service registry');
  } catch (error) {
    console.error('[Voice Device] Failed to register with service registry:', error.message);
  }
};

const voiceUiSchema = {
  name: 'voice-headset-ui',
  components: {
    text: { description: 'Narrative text for voice-first feedback.' },
    button: { description: 'Action button that can initiate or stop listening.' },
    transcript: { description: 'Displays the latest recognized voice command.' },
    prompts: { description: 'Suggested voice commands for user assistance.' },
  },
  context: {
    modalityPreference: 'audio-first',
    primaryInput: 'voice',
    controlledThing: 'light-switch',
  },
};

const registerWithCoreSystem = async () => {
  const deviceRegistrationPayload = {
    id: deviceId,
    name: deviceName,
    url: devicePublicUrl,
    thingId: 'thing-light-switch-001',
    capabilities: [],
    metadata: {
      deviceType: 'voice-headset',
      supportedUiComponents: ['text', 'button', 'transcript', 'prompts'],
      supportsAudio: true,
      supportsDictation: true,
      supportsTouch: false,
      modalityPreference: 'audio-first',
      uiSchema: voiceUiSchema,
    },
    uiSchema: voiceUiSchema,
  };

  try {
    await fetch(`${coreSystemUrl}/register/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deviceRegistrationPayload),
    });
    console.log('[Voice Device] Registered voice controller with core system');
  } catch (error) {
    console.error('[Voice Device] Failed to register with core system:', error.message);
  }
};

app.get('/api/config', (_req, res) => {
  res.json({
    deviceId,
    deviceName,
    recognitionLanguage,
    coreWebsocketUrl,
    sampleCommands: [
      'Turn on the light',
      'Turn off the light',
      'Toggle the light',
      'What is the light status?',
    ],
  });
});

app.post('/api/voice-command', async (req, res) => {
  const { transcript } = req.body || {};

  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'A transcript string is required.' });
  }

  const action = mapTranscriptToAction(transcript);
  console.log(`[Voice Device] Transcript received: "${transcript}" -> ${action || 'no action detected'}`);

  if (!action) {
    return res.json({
      transcript,
      action: null,
      message: 'No matching action detected. Try commands like "turn on", "turn off", or "toggle".',
    });
  }

  try {
    const payload = await callLightSwitchEndpoint(action);
    return res.json({
      transcript,
      action,
      message: `Executed '${action}' successfully`,
      thingResponse: payload,
    });
  } catch (error) {
    console.error('[Voice Device] Failed to execute action:', error.message);
    return res.status(502).json({
      transcript,
      action,
      error: `Failed to execute '${action}': ${error.message}`,
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', deviceId });
});

app.listen(port, listenAddress, () => {
  console.log(`[Voice Device] Listening at ${listenAddress}:${port} (public URL: ${devicePublicUrl})`);
  registerWithServiceRegistry();
  registerWithCoreSystem();
});
