import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());

const port = 3003;
const moduleName = 'user-activity-sensor';
const coreRefreshEndpoint = 'http://localhost:3001/refresh';
const activityRotationIntervalMs = Number.parseInt(process.env.ACTIVITY_ROTATION_INTERVAL_MS || '90000', 10);

const activityStates = [
  {
    id: 'hands-free',
    description: 'User hands are available for interaction',
  },
  {
    id: 'hands-occupied',
    description: 'User hands are busy; defer to audio or voice interaction',
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
    console.error('Failed to notify core system about activity change:', error.message);
  }
};

const scheduleNextRotation = () => {
  if (rotationTimer) {
    clearTimeout(rotationTimer);
  }

  rotationTimer = setTimeout(() => {
    advanceActivityState();
    const activity = getCurrentActivity();
    console.log(`Auto-rotated activity state to: ${activity.id}`);
    notifyCoreOfActivityChange();
    scheduleNextRotation();
  }, activityRotationIntervalMs);
};

const registerWithServiceRegistry = async () => {
  try {
    await fetch('http://localhost:3000/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: moduleName,
        url: `http://localhost:${port}`,
        type: 'capability',
        metadata: {
          category: 'user-activity',
        },
      })
    });
    console.log('Registered with service registry');
  } catch (error) {
    console.error('Error registering with service registry:', error);
  }
};

const registerWithCoreSystem = async () => {
  const capabilityRegistrationPayload = {
    name: moduleName,
    url: `http://localhost:${port}`,
    provides: ['userActivity'],
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
  };

  try {
    await fetch('http://localhost:3001/register/capability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(capabilityRegistrationPayload),
    });
    console.log('Registered capability with core system');
  } catch (error) {
    console.error('Error registering capability with core system:', error);
  }
};

app.get('/activity/states', (req, res) => {
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
  console.log(`Activity state manually set to: ${activity.id}`);
  notifyCoreOfActivityChange();
  scheduleNextRotation();
  res.json({ status: 'updated', activity });
});

app.post('/activity/next', (_req, res) => {
  advanceActivityState();
  const activity = getCurrentActivity();
  console.log(`Activity state advanced to: ${activity.id}`);
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

app.listen(port, () => {
  console.log(`User activity sensor listening at http://localhost:${port}`);
  registerWithServiceRegistry();
  registerWithCoreSystem();
  scheduleNextRotation();
});