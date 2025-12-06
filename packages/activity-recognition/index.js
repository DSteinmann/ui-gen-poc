import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());

const port = Number.parseInt(process.env.ACTIVITY_RECOGNITION_PORT || process.env.CAPABILITY_PORT || '3003', 10);
const serviceName = 'activity-recognition';
const capabilityAlias = 'userActivity';
const listenAddress = process.env.BIND_ADDRESS || '0.0.0.0';
const coreSystemBaseUrl = process.env.CORE_SYSTEM_URL || 'http://core-system:3001';
const serviceRegistryUrl = process.env.SERVICE_REGISTRY_URL || 'http://core-system:3000';
const publicUrl = process.env.ACTIVITY_RECOGNITION_PUBLIC_URL || process.env.CAPABILITY_PUBLIC_URL || `http://activity-recognition:${port}`;
const coreRefreshEndpoint = `${coreSystemBaseUrl}/refresh`;
const activityRotationIntervalMs = Number.parseInt(process.env.ACTIVITY_ROTATION_INTERVAL_MS || '90000', 10);

const toolDefinitions = {
  getUserActivity: {
    description: 'Retrieve the latest classified user activity state for the environment.',
    capability: capabilityAlias,
    service: serviceName,
    method: 'GET',
    path: '/activity',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    returns: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Activity identifier code.' },
        description: { type: 'string', description: 'Human readable explanation of the activity state.' },
        timestamp: { type: 'string', format: 'date-time', description: 'ISO timestamp of the observation.' },
        confidence: { type: 'number', description: 'Classifier confidence between 0 and 1.' },
      },
      required: ['id', 'description', 'timestamp'],
      additionalProperties: true,
    },
  },
};

const activityStates = [
  {
    id: 'hands-free',
    description: 'User hands are available for interaction',
  },
  {
    id: 'hands-occupied',
    description: 'User hands are busy; defer to audio or voice interaction',
  },
  {
    id: 'running',
    description: 'User is running; prioritize short interactions and large tap targets',
    ergonomicsProfile: 'large-tap-targets',
  },
];

let currentActivityIndex = 0;
let rotationTimer;

const getCurrentActivity = () => activityStates[currentActivityIndex];

const advanceActivityState = () => {
  currentActivityIndex = (currentActivityIndex + 1) % activityStates.length;
};

const notifyCoreOfActivityChange = async () => {
  try {
    await fetch(coreRefreshEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch (error) {
    console.error('[Activity Recognition] Failed to notify core system about activity change:', error.message);
  }
};

const scheduleNextRotation = () => {
  if (rotationTimer) {
    clearTimeout(rotationTimer);
  }

  rotationTimer = setTimeout(() => {
    advanceActivityState();
    const activity = getCurrentActivity();
    console.log(`[Activity Recognition] Auto-rotated activity state to: ${activity.id}`);
    notifyCoreOfActivityChange();
    scheduleNextRotation();
  }, activityRotationIntervalMs);
};

const registerWithServiceRegistry = async () => {
  try {
    await fetch(`${serviceRegistryUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: serviceName,
        url: publicUrl,
        type: 'capability',
        metadata: {
          category: 'user-activity',
          tools: Object.keys(toolDefinitions),
        },
      })
    });
    console.log('[Activity Recognition] Registered with service registry');
  } catch (error) {
    console.error('[Activity Recognition] Error registering with service registry:', error);
  }
};

const registerWithCoreSystem = async () => {
  const capabilityRegistrationPayload = {
    name: serviceName,
    url: publicUrl,
    provides: [capabilityAlias],
    metadata: {
      description: 'Detects whether the user has their hands free or occupied.',
      reportingIntervalSeconds: Math.round(activityRotationIntervalMs / 1000),
    },
    endpoints: {
      default: {
        path: '/activity',
        method: 'GET',
      },
    },
    tools: toolDefinitions,
  };

  try {
    await fetch(`${coreSystemBaseUrl}/register/capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(capabilityRegistrationPayload),
    });
    console.log('[Activity Recognition] Registered capability and tool with core system');
  } catch (error) {
    console.error('[Activity Recognition] Error registering capability with core system:', error);
  }
};

app.get('/activity/states', (_req, res) => {
  res.json({ states: activityStates });
});

app.post('/activity/state', (req, res) => {
  const { state } = req.body;
  const stateIndex = activityStates.findIndex((entry) => entry.id === state);

  if (stateIndex === -1) {
    return res.status(400).json({ error: `Unknown state '${state}'.` });
  }

  currentActivityIndex = stateIndex;
  const activity = getCurrentActivity();
  console.log(`[Activity Recognition] Activity state manually set to: ${activity.id}`);
  notifyCoreOfActivityChange();
  scheduleNextRotation();
  res.json({ status: 'updated', activity });
});

app.post('/activity/next', (_req, res) => {
  advanceActivityState();
  const activity = getCurrentActivity();
  console.log(`[Activity Recognition] Activity state advanced to: ${activity.id}`);
  notifyCoreOfActivityChange();
  scheduleNextRotation();
  res.json({ status: 'advanced', activity });
});

app.get('/activity', (_req, res) => {
  const activity = getCurrentActivity();
  res.json({
    ...activity,
    timestamp: new Date().toISOString(),
    confidence: 0.85,
  });
});

app.listen(port, listenAddress, () => {
  console.log(`[Activity Recognition] Listening at ${listenAddress}:${port} (public URL: ${publicUrl})`);
  registerWithServiceRegistry();
  registerWithCoreSystem();
  scheduleNextRotation();
});