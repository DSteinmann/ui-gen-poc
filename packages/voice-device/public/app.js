const logList = document.querySelector('#command-log');
const listeningIndicator = document.querySelector('#listening-indicator');
const lastTranscript = document.querySelector('#last-transcript');
const lastAction = document.querySelector('#last-action');
const lightStatus = document.querySelector('#light-status');
const deviceDescription = document.querySelector('#device-description');
const sampleCommandsList = document.querySelector('#sample-commands');
const unsupportedSection = document.querySelector('#unsupported');

const startBtn = document.querySelector('#start-btn');
const stopBtn = document.querySelector('#stop-btn');
const checkStatusBtn = document.querySelector('#check-status-btn');

let recognition;
let isListening = false;
let config;
let websocket;
let reconnectTimer;
let lastUiEventId;
let lastAutoListenAttempt = 0;
let userGrantedMic = false;
let unloadHandlerRegistered = false;

const AUTO_LISTEN_COOLDOWN_MS = 8000;
const RECONNECT_DELAY_MS = 4000;
const dockerInternalHostnames = new Set([
  'core-system',
  'activity-recognition',
  'knowledge-base',
  'device-api',
  'device-ui',
  'voice-device',
  'things',
  '0.0.0.0',
]);

const appendLog = (entry) => {
  const li = document.createElement('li');
  const header = document.createElement('strong');
  header.textContent = entry.header;
  const detail = document.createElement('small');
  detail.textContent = entry.detail;
  li.appendChild(header);
  li.appendChild(document.createElement('br'));
  li.appendChild(detail);
  logList.prepend(li);
};

const setListeningState = (listening) => {
  isListening = listening;
  listeningIndicator.textContent = listening ? 'active' : 'inactive';
  listeningIndicator.classList.toggle('active', listening);
  startBtn.disabled = listening;
  stopBtn.disabled = !listening;
};

const updateLightStatus = (statePayload) => {
  if (!statePayload) {
    return;
  }
  const { status, timestamp } = statePayload;
  lightStatus.textContent = `${status || 'unknown'} @ ${timestamp ? new Date(timestamp).toLocaleTimeString() : '—'}`;
};

const fetchConfig = async () => {
  const response = await fetch('/api/config');
  if (!response.ok) {
    throw new Error('Failed to load device config');
  }
  return response.json();
};

const handleTranscript = async (transcript) => {
  lastTranscript.textContent = transcript;

  const response = await fetch('/api/voice-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript }),
  });

  const payload = await response.json();

  if (!response.ok) {
    appendLog({
      header: 'Command failed',
      detail: `${payload?.error || 'Unknown error'} ("${transcript}")`,
    });
    lastAction.textContent = 'error';
    return;
  }

  if (!payload.action) {
    appendLog({
      header: 'No action detected',
      detail: `"${transcript}"`,
    });
    lastAction.textContent = 'none';
    return;
  }

  appendLog({
    header: `Action: ${payload.action}`,
    detail: payload.message,
  });
  lastAction.textContent = payload.action;
  updateLightStatus(payload?.thingResponse?.state || payload?.thingResponse);
};

const queryStatus = async () => {
  const dummyTranscript = 'status';
  await handleTranscript(dummyTranscript);
};

const initialiseRecognition = () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    unsupportedSection.hidden = false;
    startBtn.disabled = true;
    stopBtn.disabled = true;
    checkStatusBtn.disabled = false;
    appendLog({
      header: 'Speech recognition unavailable',
      detail: 'Use a supported browser (Chrome/Edge) to enable dictation.',
    });
    return null;
  }

  const instance = new SpeechRecognition();
  instance.lang = config.recognitionLanguage || 'en-US';
  instance.continuous = false;
  instance.interimResults = false;
  instance.maxAlternatives = 1;

  instance.onstart = () => {
    userGrantedMic = true;
    setListeningState(true);
  };
  instance.onend = () => setListeningState(false);
  instance.onerror = (event) => {
    setListeningState(false);
    if (event.error === 'not-allowed' && !userGrantedMic) {
      appendLog({
        header: 'Microphone permission blocked',
        detail: 'Tap "Start Listening" to grant access, then automations can resume.',
      });
    } else {
    appendLog({
      header: 'Recognition error',
      detail: event.error || 'Unknown error',
    });
    }
  };
  instance.onresult = (event) => {
    const text = Array.from(event.results)
      .map((result) => result[0]?.transcript)
      .filter(Boolean)
      .join(' ')
      .trim();

    if (text) {
      handleTranscript(text);
    }
  };

  return instance;
};

const attachEventListeners = () => {
  startBtn.addEventListener('click', () => {
    if (recognition && !isListening) {
      recognition.start();
    }
  });

  stopBtn.addEventListener('click', () => {
    if (recognition && isListening) {
      recognition.stop();
    }
  });

  checkStatusBtn.addEventListener('click', queryStatus);
};

const populateSampleCommands = (samples) => {
  sampleCommandsList.innerHTML = '';
  samples.forEach((sample) => {
    const li = document.createElement('li');
    li.textContent = sample;
    sampleCommandsList.appendChild(li);
  });
};

const resolveWebsocketUrl = () => {
  if (!config?.coreWebsocketUrl) {
    return null;
  }

  try {
    const resolvedBase = new URL(config.coreWebsocketUrl, window.location.href);
    if (dockerInternalHostnames.has(resolvedBase.hostname)) {
      resolvedBase.hostname = window.location.hostname || 'localhost';
    }

    if (!resolvedBase.port) {
      resolvedBase.port = '3001';
    }

    resolvedBase.searchParams.set('deviceId', config.deviceId);

    if (window.location.protocol === 'https:') {
      resolvedBase.protocol = 'wss:';
    } else if (resolvedBase.protocol === 'http:') {
      resolvedBase.protocol = 'ws:';
    }

    return resolvedBase.toString();
  } catch (error) {
    console.warn('Failed to resolve websocket URL, falling back to heuristic.', error);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
  const port = '3001';
    return `${protocol}//${host}:${port}?deviceId=${encodeURIComponent(config.deviceId)}`;
  }
};

const maybeAutoStartListening = (reason) => {
  if (!recognition || isListening) {
    return;
  }

  const now = Date.now();
  if (now - lastAutoListenAttempt < AUTO_LISTEN_COOLDOWN_MS) {
    return;
  }

  lastAutoListenAttempt = now;

  try {
    recognition.start();
    appendLog({
      header: 'Auto listening engaged',
      detail: reason,
    });
  } catch (error) {
    if (error?.name === 'NotAllowedError') {
      appendLog({
        header: 'Microphone access blocked',
        detail: 'Tap "Start Listening" once to grant permission so automatic listening can resume.',
      });
      lastAutoListenAttempt = 0;
    } else if (error?.name !== 'InvalidStateError') {
      appendLog({
        header: 'Auto listening failed',
        detail: error.message || 'Unknown error while starting recognition automatically.',
      });
    }
  }
};

const handleUiUpdate = (payload) => {
  if (!payload || (payload.deviceId && payload.deviceId !== config.deviceId)) {
    return;
  }

  const eventId = payload.generatedAt || (payload.ui ? JSON.stringify(payload.ui) : null);
  if (eventId && eventId === lastUiEventId) {
    return;
  }

  if (eventId) {
    lastUiEventId = eventId;
  }

  maybeAutoStartListening('Core system routed the latest UI to this voice device.');
};

const disconnectWebsocket = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (websocket) {
    websocket.close();
    websocket = null;
  }
};

const connectWebsocket = () => {
  const websocketUrl = resolveWebsocketUrl();
  if (!websocketUrl) {
    return;
  }

  disconnectWebsocket();

  try {
    websocket = new WebSocket(websocketUrl);
  } catch (error) {
    console.error('Failed to create websocket connection:', error);
    reconnectTimer = setTimeout(connectWebsocket, RECONNECT_DELAY_MS);
    return;
  }

  websocket.onopen = () => {
    console.log('Connected to core-system websocket.');
  };

  websocket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      handleUiUpdate(payload);
    } catch (error) {
      console.error('Failed to parse websocket message:', error);
    }
  };

  websocket.onerror = (event) => {
    console.error('Websocket error', event);
  };

  websocket.onclose = () => {
    websocket = null;
    reconnectTimer = setTimeout(connectWebsocket, RECONNECT_DELAY_MS);
  };
};

const bootstrap = async () => {
  try {
    config = await fetchConfig();
    deviceDescription.textContent = `${config.deviceName} (ID: ${config.deviceId})`;
    populateSampleCommands(config.sampleCommands || []);
    recognition = initialiseRecognition();
    attachEventListeners();
    connectWebsocket();
    if (!unloadHandlerRegistered) {
      window.addEventListener('beforeunload', disconnectWebsocket);
      unloadHandlerRegistered = true;
    }
  } catch (error) {
    console.error(error);
    appendLog({
      header: 'Initialisation failed',
      detail: error.message,
    });
  }
};

bootstrap();
