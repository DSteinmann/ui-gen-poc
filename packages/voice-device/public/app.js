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

  instance.onstart = () => setListeningState(true);
  instance.onend = () => setListeningState(false);
  instance.onerror = (event) => {
    setListeningState(false);
    appendLog({
      header: 'Recognition error',
      detail: event.error || 'Unknown error',
    });
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

const bootstrap = async () => {
  try {
    config = await fetchConfig();
    deviceDescription.textContent = `${config.deviceName} (ID: ${config.deviceId})`;
    populateSampleCommands(config.sampleCommands || []);
    recognition = initialiseRecognition();
    attachEventListeners();
  } catch (error) {
    console.error(error);
    appendLog({
      header: 'Initialisation failed',
      detail: error.message,
    });
  }
};

bootstrap();
