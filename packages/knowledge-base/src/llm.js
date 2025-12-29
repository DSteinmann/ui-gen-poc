import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import {
  LLM_ENDPOINT,
  LLM_DEFAULT_MODEL,
  OPEN_ROUTER_API_KEY,
  OPEN_ROUTER_API_URL,
  OPEN_ROUTER_MODEL,
  OPEN_ROUTER_REFERER,
  OPEN_ROUTER_TITLE,
  OPEN_ROUTER_REASONING_EFFORT,
  LLM_LOG_DIR,
  CORE_OUTPUT_SCHEMA_PATH,
  SERVICE_REGISTRY_URL
} from './config.js';
import { retrieveRelevantDocuments } from './rag.js';
import { getDocuments, buildUserPreferenceContext, nowIsoString } from './store.js';

// ---- Logging & Stats ----

const LLM_LOG_FILE = path.join(LLM_LOG_DIR, 'llm-transcripts.log');
const LLM_STATS_FILE = path.join(LLM_LOG_DIR, 'llm-stats.json');

const ensureLogDirectory = () => {
  if (!fs.existsSync(LLM_LOG_DIR)) {
    fs.mkdirSync(LLM_LOG_DIR, { recursive: true });
  }
};

const appendLlmTranscript = (entry) => {
  try {
    ensureLogDirectory();
    fs.appendFileSync(LLM_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch (error) {
    console.error('[LLM] Failed to append transcript:', error.message);
  }
};

const llmStats = {
  totalCalls: 0,
  totalDurationMs: 0,
  totalTokens: 0,
  providers: {},
  models: {},
  lastUpdated: null,
};

const persistLlmStats = () => {
  try {
    ensureLogDirectory();
    fs.writeFileSync(LLM_STATS_FILE, JSON.stringify(llmStats, null, 2), 'utf-8');
  } catch (error) {
    console.error('[LLM] Failed to persist stats:', error.message);
  }
};

const recordLlmStats = ({ provider, model, durationMs, tokens }) => {
  llmStats.totalCalls += 1;
  llmStats.totalDurationMs += durationMs;
  if (typeof tokens === 'number' && Number.isFinite(tokens)) {
    llmStats.totalTokens += tokens;
  }

  if (provider) {
    llmStats.providers[provider] = llmStats.providers[provider] || { calls: 0, durationMs: 0 };
    llmStats.providers[provider].calls += 1;
    llmStats.providers[provider].durationMs += durationMs;
  }

  if (model) {
    llmStats.models[model] = llmStats.models[model] || { calls: 0, tokens: 0, durationMs: 0 };
    llmStats.models[model].calls += 1;
    llmStats.models[model].durationMs += durationMs;
    if (typeof tokens === 'number' && Number.isFinite(tokens)) {
      llmStats.models[model].tokens += tokens;
    }
  }

  llmStats.lastUpdated = nowIsoString();
  persistLlmStats();
};

const logLlmInteraction = ({ contextLabel, provider, model, requestPayload, responsePayload, durationMs, error }) => {
  const entry = {
    timestamp: nowIsoString(),
    contextLabel,
    provider,
    model,
    durationMs,
    error: error ? error.message || String(error) : null,
    request: requestPayload,
    response: responsePayload,
  };

  appendLlmTranscript(entry);

  if (!error) {
    const tokens = responsePayload?.usage?.total_tokens || null;
    recordLlmStats({ provider, model, durationMs, tokens });
  }
};

// ---- Configuration Resolution ----

export const resolveLlmConfiguration = () => {
  const hasOpenRouter = Boolean(OPEN_ROUTER_API_KEY);
  const hasLocal = Boolean(LLM_ENDPOINT);
  const provider = hasOpenRouter ? 'openrouter' : hasLocal ? 'local' : 'unconfigured';
  const model = hasOpenRouter ? OPEN_ROUTER_MODEL || LLM_DEFAULT_MODEL : LLM_DEFAULT_MODEL;

  return {
    provider,
    model,
    endpoint: provider === 'openrouter' ? OPEN_ROUTER_API_URL : provider === 'local' ? LLM_ENDPOINT : null,
    fallbackModel: LLM_DEFAULT_MODEL,
    openRouterModel: OPEN_ROUTER_MODEL || null,
    allowsFallback: hasOpenRouter && hasLocal,
    timestamp: nowIsoString(),
  };
};

// ---- Invocation ----

export const invokeChatCompletion = async (requestBody, { contextLabel = 'llm-request' } = {}) => {
  const effectiveModel = requestBody.model || OPEN_ROUTER_MODEL || LLM_DEFAULT_MODEL;
  const basePayload = { ...requestBody, model: effectiveModel };

  if (OPEN_ROUTER_REASONING_EFFORT) {
    const normalizedEffort = OPEN_ROUTER_REASONING_EFFORT.trim();
    if (normalizedEffort.length > 0) {
      const existingReasoning = typeof basePayload.reasoning === 'object' ? basePayload.reasoning : {};
      basePayload.reasoning = {
        ...existingReasoning,
        effort: normalizedEffort,
      };
    }
  }

  const callOpenRouter = async () => {
    if (!OPEN_ROUTER_API_KEY) {
      throw new Error('OpenRouter API key not configured.');
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPEN_ROUTER_API_KEY}`,
    };

    if (OPEN_ROUTER_REFERER) {
      headers['HTTP-Referer'] = OPEN_ROUTER_REFERER;
    }

    if (OPEN_ROUTER_TITLE) {
      headers['X-Title'] = OPEN_ROUTER_TITLE;
    }

    console.log(`[LLM] Invoking OpenRouter (${contextLabel}) with model ${basePayload.model}.`);
    const response = await fetch(OPEN_ROUTER_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(basePayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter responded with status ${response.status}: ${errorText}`);
    }

    return response.json();
  };

  const callLocalEndpoint = async () => {
    if (!LLM_ENDPOINT) {
      throw new Error('Local LLM endpoint not configured.');
    }

    console.log(`[LLM] Invoking local LLM (${contextLabel}) at ${LLM_ENDPOINT} with model ${basePayload.model}.`);
    const response = await fetch(LLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local LLM responded with status ${response.status}: ${errorText}`);
    }

    return response.json();
  };

  if (OPEN_ROUTER_API_KEY) {
    const openRouterStart = Date.now();
    try {
      const data = await callOpenRouter();
      const durationMs = Date.now() - openRouterStart;
      logLlmInteraction({
        contextLabel,
        provider: 'openrouter',
        model: basePayload.model,
        requestPayload: basePayload,
        responsePayload: data,
        durationMs,
      });
      return { data, provider: 'openrouter', model: basePayload.model, durationMs };
    } catch (error) {
      const durationMs = Date.now() - openRouterStart;
      logLlmInteraction({
        contextLabel,
        provider: 'openrouter',
        model: basePayload.model,
        requestPayload: basePayload,
        responsePayload: null,
        durationMs,
        error,
      });
      console.error(`[LLM] OpenRouter request failed for ${contextLabel}:`, error.message);
      if (!LLM_ENDPOINT) {
        throw error;
      }
    }
  }

  if (!LLM_ENDPOINT) {
    throw new Error('No LLM endpoint available. Configure OPENROUTER_API_KEY or LLM_ENDPOINT.');
  }

  const localStart = Date.now();
  try {
    const data = await callLocalEndpoint();
    const durationMs = Date.now() - localStart;
    logLlmInteraction({
      contextLabel,
      provider: 'local',
      model: basePayload.model,
      requestPayload: basePayload,
      responsePayload: data,
      durationMs,
    });
    return { data, provider: 'local', model: basePayload.model, durationMs };
  } catch (error) {
    const durationMs = Date.now() - localStart;
    logLlmInteraction({
      contextLabel,
      provider: 'local',
      model: basePayload.model,
      requestPayload: basePayload,
      responsePayload: null,
      durationMs,
      error,
    });
    console.error(`[LLM] Local LLM endpoint failed for ${contextLabel}:`, error.message);
    throw error;
  }
};

// ---- Device Selection ----

const deviceSelectionJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'DeviceSelectionResponse',
  type: 'object',
  properties: {
    targetDeviceId: {
      type: 'string',
      description: 'Identifier of the device that should receive the generated UI.',
    },
    reason: {
      type: 'string',
      description: 'Natural language rationale explaining why the device was selected.',
    },
    confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'Self-reported confidence in the selection.',
    },
    alternateDeviceIds: {
      type: 'array',
      description: 'Optional list of fallback device identifiers in preference order.',
      items: { type: 'string' },
    },
    requestedCapabilities: {
      type: 'array',
      items: { type: 'string' },
      description: 'Echo of the capability list considered for the selection.',
    },
    considerations: {
      type: 'array',
      description: 'Bullet-point style list capturing the key criteria used when deciding.',
      items: { type: 'string' },
    },
  },
  required: ['targetDeviceId', 'reason'],
};

export const runDeviceSelection = async ({
  prompt,
  fallbackPrompt,
  desiredCapabilities = [],
  thingDescription,
  candidates = [],
  model,
}) => {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('No device candidates provided for selection.');
  }

  const candidateSummaries = candidates.map((candidate, index) => {
    const supportedComponents = Array.isArray(candidate.metadata?.supportedUiComponents)
      ? candidate.metadata.supportedUiComponents.join(', ')
      : 'unspecified';

    const capabilityScore = candidate.score || {};
    const matchSummary = capabilityScore.supportsAll
      ? 'supports all requested capabilities'
      : capabilityScore.matches || capabilityScore.missing
        ? `matches ${capabilityScore.matches || 0}, missing ${(capabilityScore.missing || []).join(', ') || 'none'}`
        : 'no score available';

    const features = [
      `Capabilities: ${(candidate.capabilities || []).join(', ') || 'none'}`,
      `Supported components: ${supportedComponents}`,
      `Supports audio: ${candidate.metadata?.supportsAudio ? 'yes' : 'no'}`,
      `Supports dictation: ${candidate.metadata?.supportsDictation ? 'yes' : 'no'}`,
      `Supports theming: ${Array.isArray(candidate.metadata?.supportsTheming) ? candidate.metadata.supportsTheming.join(', ') : 'no'}`,
      `Modality preference: ${candidate.metadata?.modalityPreference || 'unspecified'}`,
      `Capability match: ${matchSummary}`,
    ];

    return `Candidate ${index + 1}: ${candidate.name} (${candidate.id})\n${features.join('\n')}`;
  }).join('\n\n');

  const retrievedDocuments = retrieveRelevantDocuments(getDocuments(), {
    prompt,
    thingDescription,
    capabilities: desiredCapabilities,
    capabilityData: null,
    missingCapabilities: null,
    device: null,
    uiContext: null,
  });

  const knowledgeContext = retrievedDocuments.length
    ? retrievedDocuments.map((doc, index) => `Doc ${index + 1} (score ${doc.score.toFixed(3)}): ${doc.content}`).join('\n\n')
    : null;
  const preferenceContext = buildUserPreferenceContext();

  const selectionMessages = [
    {
      role: 'system',
      content: 'You are a device orchestration planner. Choose the best device from the provided candidates to render the requested UI. Consider capability coverage, modality support, and any documented requirements. Respond strictly using the provided JSON schema.',
    },
    {
      role: 'system',
      content: `Device candidates:\n${candidateSummaries}`,
    },
  ];

  if (knowledgeContext) {
    selectionMessages.push({
      role: 'system',
      content: `Supporting requirement documents:\n${knowledgeContext}`,
    });
  }

  if (preferenceContext) {
    selectionMessages.push({
      role: 'system',
      content: `Persistent household preferences:\n${preferenceContext}`,
    });
  }

  const selectionPayload = {
    prompt,
    fallbackPrompt,
    desiredCapabilities,
    thingDescription,
    candidates,
  };

  selectionMessages.push({
    role: 'user',
    content: JSON.stringify(selectionPayload, null, 2),
  });

  const resolvedModel = model || OPEN_ROUTER_MODEL || LLM_DEFAULT_MODEL;
  const requestBody = {
    model: resolvedModel,
    messages: selectionMessages,
    temperature: 0.3,
    response_format: {
      type: 'json_schema',
      json_schema: { schema: deviceSelectionJsonSchema },
    },
  };

  const { data } = await invokeChatCompletion(requestBody, { contextLabel: 'device-selection' });
  const selectionMessage = data?.choices?.[0]?.message;
  if (!selectionMessage?.content) {
    throw new Error('Device selection LLM returned an empty response.');
  }

  const cleanedContent = typeof selectionMessage.content === 'string' 
    ? selectionMessage.content.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim()
    : selectionMessage.content;

  try {
    return typeof cleanedContent === 'string'
      ? JSON.parse(cleanedContent)
      : Array.isArray(cleanedContent)
        ? cleanedContent[0]
        : cleanedContent;
  } catch (error) {
    console.error('[LLM] Failed to parse device selection content:', error);
    throw new Error('Unable to parse device selection response.');
  }
};

// ---- UI Generation Helpers ----

const normalizeScalarToken = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const token = value.trim().toLowerCase();
  return token.length ? token : null;
};

const LARGE_TAP_TARGET_PROFILE = 'large-tap-targets';
const LARGE_TAP_ALIASES = new Set([
  LARGE_TAP_TARGET_PROFILE,
  'large tap targets',
  'glove-mode',
  'glove mode',
  'running-friendly',
  'running friendly',
]);

const resolveErgonomicsProfile = (value) => {
  const token = normalizeScalarToken(value);
  if (!token) return null;
  if (LARGE_TAP_ALIASES.has(token)) return LARGE_TAP_TARGET_PROFILE;
  return token;
};

const composeToolUrl = (base, path = '') => {
  if (!path || path === '/') {
    return base;
  }
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

const parseAssistantContent = (content) => {
  if (!content || typeof content !== 'string') {
    return null;
  }
  
  let cleanContent = content.trim();
  // Cleanup markdown code blocks if present
  if (cleanContent.startsWith('```json')) {
    cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleanContent.startsWith('```')) {
    cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  try {
    return JSON.parse(cleanContent);
  } catch (error) {
    console.error('[LLM] Failed to parse assistant content as JSON:', error);
    return null;
  }
};

// Load schema synchronously 
let defaultOutputSchema;
try {
  defaultOutputSchema = JSON.parse(fs.readFileSync(CORE_OUTPUT_SCHEMA_PATH, 'utf-8'));
} catch (error) {
  console.error('[LLM] Failed to load default output schema:', error.message);
  defaultOutputSchema = {};
}

// ---- Agent Execution ----

export async function runAgent({ prompt, thingDescription, capabilities = [], uiSchema = {}, capabilityData, missingCapabilities, device, deviceId, selection, thingActions = [], availableThings = [] }) {
  const availableComponents = uiSchema.components || {};
  const availableComponentNames = Object.keys(availableComponents);
  const availableTools = uiSchema.tools || {};
  const availableToolNames = Object.keys(availableTools);

  const responseSchemaSource =
    (uiSchema && typeof uiSchema === 'object'
      && (uiSchema.responseSchema || uiSchema.outputSchema || uiSchema.jsonSchema))
      || defaultOutputSchema;

  const filteredSchema = responseSchemaSource
    ? JSON.parse(JSON.stringify(responseSchemaSource))
    : null;

  const retrievedDocuments = retrieveRelevantDocuments(getDocuments(), {
    prompt,
    thingDescription,
    capabilityData,
    capabilities,
    missingCapabilities,
    device,
    uiContext: uiSchema.context,
    thingActions,
    availableThings,
  });

  const preferenceContext = buildUserPreferenceContext();

  const allowedActionIds = Array.isArray(thingActions)
    ? thingActions.map((action) => action && action.id).filter(Boolean)
    : [];

  if (filteredSchema?.definitions) {
    for (const key in filteredSchema.definitions) {
      if (key.endsWith('Component') && !availableComponentNames.includes(key.replace('Component', ''))) {
        delete filteredSchema.definitions[key];
      }
    }

    if (filteredSchema.definitions.component?.oneOf) {
      filteredSchema.definitions.component.oneOf = filteredSchema.definitions.component.oneOf.filter((ref) => {
        const componentName = ref.$ref.split('/').pop().replace('Component', '');
        return availableComponentNames.includes(componentName) || componentName === 'toolCall';
      });
    }

    if (filteredSchema.definitions.toolCall) {
      if (availableToolNames.length > 0) {
        filteredSchema.definitions.toolCall.properties.tool.enum = availableToolNames;
      } else {
        delete filteredSchema.definitions.toolCall;
        if (filteredSchema.definitions.component?.oneOf) {
          filteredSchema.definitions.component.oneOf = filteredSchema.definitions.component.oneOf.filter((ref) => ref.$ref !== '#/definitions/toolCall');
        }
      }
    }
  }

  const toolDefinitions = Object.entries(availableTools).map(([name, tool]) => {
    const parameterSchema = tool && typeof tool.parameters === 'object'
      ? tool.parameters
      : { type: 'object', properties: {}, additionalProperties: false };

    return {
      type: 'function',
      function: {
        name,
        description: tool?.description || `Invoke tool '${name}'`,
        parameters: parameterSchema,
      },
    };
  });

  const requirementContext = retrievedDocuments
    .map((doc, index) => `Document ${index + 1} (score: ${doc.score.toFixed(3)}):\nSource: ${doc.metadata?.source || 'unspecified'}\nTags: ${(doc.tags || []).join(', ') || 'none'}\n${doc.content}`)
    .join('\n\n');

  const messages = [
    {
      role: 'system',
      content: `You are a UI generator. Your goal is to create a context-aware UI based on the user's prompt, the provided thing description, the requirement documents, and the available UI components.\n\nYou must generate a UI that conforms to the provided JSON schema.\n\nAvailable components: ${JSON.stringify(availableComponents)}.`,
    },
  ];

  if (requirementContext) {
    messages.push({
      role: 'system',
      content: `Use the following requirement knowledge when crafting the UI:\n\n${requirementContext}`,
    });
  }

  if (preferenceContext) {
    messages.push({
      role: 'system',
      content: `The household profile includes persistent user preferences. Apply them whenever compatible with the task:\n\n${preferenceContext}`,
    });
  }

  const activityDetails = capabilityData?.userActivity || {};
  const activitySample = activityDetails.data || activityDetails.cachedSample || null;
  const activityState = activitySample?.id || activitySample?.state || null;
  const selectionHint = selection?.reason ? selection.reason.toLowerCase() : '';
  const selectionContext = selection?.raw ? JSON.stringify(selection.raw).toLowerCase() : '';
  const activityErgonomicsProfile = resolveErgonomicsProfile(
    activitySample?.ergonomicsProfile
    || activityDetails.preferredErgonomicsProfile
    || (activityState === 'running' ? LARGE_TAP_TARGET_PROFILE : null),
  );

  const impliesHandsFree = selectionHint.includes('hands-free')
    || selectionHint.includes('touch')
    || selectionContext.includes('hands-free')
    || selectionContext.includes('touch');

  const preferLargeTapTargets = activityErgonomicsProfile === LARGE_TAP_TARGET_PROFILE
    || activityState === 'running';

  if (impliesHandsFree || activityState === 'hands-free') {
    messages.push({
      role: 'system',
      content: 'Current context indicates the user is hands-free. Avoid presenting warnings about hands being occupied or forcing voice interactions. Provide touch-friendly controls and only mention voice input as an optional enhancement.',
    });
  }

  if (activityState === 'hands-occupied') {
    messages.push({
      role: 'system',
      content: 'Current activity is hands-occupied. Offer voice-first guidance and minimize the need for touch input.',
    });
  }

  if (activityState === 'running') {
    messages.push({
      role: 'system',
      content: 'Current activity is running. Keep the UI glanceable, limit the number of required taps, and avoid dense layouts that demand precision.',
    });
  }

  if (preferLargeTapTargets) {
    messages.push({
      role: 'system',
      content: 'Set `context.defaultErgonomicsProfile` to "large-tap-targets" and prefer `size: "large"` for tactile controls (buttons, toggles, sliders, dropdowns) unless a requirement explicitly calls for compact layouts.',
    });
  } else {
    messages.push({
      role: 'system',
      content: 'Unless requirements explicitly demand larger targets, leave `context.defaultErgonomicsProfile` at "standard" and size controls normally.',
    });
  }
  if (uiSchema.theming?.supportsPrimaryColor) {
    messages.push({
      role: 'system',
      content: 'The device supports theming through the root `theme.primaryColor` field. When requirements or preferences mention a specific color (hex value), set `theme.primaryColor` accordingly to personalize the interface, while keeping sufficient contrast for readability.',
    });
  }

  if (availableToolNames.length > 0) {
    messages.push({
      role: 'system',
      content: `Tools available: ${availableToolNames.join(', ')}. Call the appropriate tool to retrieve real-time capability data before finalizing the UI response.`,
    });
  }

  if (Array.isArray(thingActions) && thingActions.length > 0) {
    const actionSummaries = thingActions.map((action) => {
      const transport = action.transport || {};
      const url = transport.url || (action.forms && action.forms[0]?.url) || 'unknown endpoint';
      const method = transport.method || (action.forms && action.forms[0]?.method) || 'POST';
      const capability = action.metadata?.capability ? `Capability: ${action.metadata.capability}. ` : '';
      const intentAliases = Array.isArray(action.metadata?.intentAliases) && action.metadata.intentAliases.length > 0
        ? `Intent aliases: ${action.metadata.intentAliases.join(', ')}. `
        : '';
      return `- ${action.title || action.name || action.id} (id: ${action.id}) — ${action.description || 'No description provided.'} ${capability}${intentAliases}Invoke via ${method} ${url}.`;
    }).join('\n');

    messages.push({
      role: 'system',
      content: `The target Thing exposes these WoT actions:
${actionSummaries}
Reference the action id in generated components so downstream services can invoke them without hard-coding transport details. If you introduce a higher-level control, you must map it to either an existing action id or one of the documented intent aliases—do NOT invent new command names or payload shapes.`,
    });

  } else if (Array.isArray(availableThings) && availableThings.length > 0) {
    messages.push({
      role: 'system',
      content: 'Multiple Things are registered, but no executable actions were provided. Prefer read-only controls until action descriptors arrive.',
    });
  }

  if (Array.isArray(availableThings) && availableThings.length > 0) {
    const availableThingSummary = availableThings.map((thing) => {
      const label = thing.title || thing.metadata?.deviceType || thing.id;
      return `- ${label} (id: ${thing.id})`;
    }).join('\n');

    messages.push({
      role: 'system',
      content: `Available Things detected:\n${availableThingSummary}\nYou may create separate sections/components for different thingIds. Always include the corresponding thingId on each control so the downstream device knows which Thing to target.`,
    });
  }

  if (allowedActionIds.length > 0) {
    messages.push({
      role: 'system',
      content: `STRICT REQUIREMENT: Only the following action ids may appear in the generated UI: ${allowedActionIds.join(', ')}. Every button, toggle, slider, or interactive component must reference one of these ids (either by copying the full descriptor or by setting an object such as { "type": "thingAction", "id": "<allowed-id>" }). If no provided action satisfies a user need, omit the control entirely instead of inventing command names (e.g., never output "setPower").`,
    });
  } else {
    messages.push({
      role: 'system',
      content: 'No executable Thing actions are available. Do not create interactive components that attempt to call missing actions; focus on informative or read-only UI elements until actions are registered.',
    });
  }

  if (selection?.reason && device?.name) {
    messages.push({
      role: 'system',
      content: `The core system selected device "${device.name}" (${device.id}) for this UI because: ${selection.reason}. Respect any device-specific limitations when building the UI.`,
    });
  }

  const userContext = {
    prompt,
    thingDescription,
    deviceId,
    device,
    capabilityData,
    missingCapabilities,
    selection,
    thingActions,
    availableThings,
  };

  messages.push({
    role: 'user',
    content: JSON.stringify(userContext, null, 2),
  });

  let uiDefinition;
  let toolInteractionOccurred = false;
  let schemaReminderAdded = false;
  let attemptsWithoutTool = 0;
  const maxAttemptsWithoutTool = 2;
  const schemaAvailable = Boolean(filteredSchema);
  let enforceSchema = schemaAvailable && availableToolNames.length === 0;
  let lastCallMeta = null;

  const resolvedModel = OPEN_ROUTER_MODEL || LLM_DEFAULT_MODEL;
  if (!resolvedModel) {
    throw new Error('No LLM model configured. Set OPENROUTER_MODEL or LLM_MODEL in the environment.');
  }

  while (true) {
    const requestPayload = {
      model: resolvedModel,
      messages,
      temperature: 0.7,
    };

    if (toolDefinitions.length > 0) {
      requestPayload.tools = toolDefinitions;
      requestPayload.tool_choice = 'auto';
    }

    if (enforceSchema && filteredSchema) {
      requestPayload.response_format = {
        type: 'json_schema',
        json_schema: { schema: filteredSchema },
      };
    }

    const { data: llmData, provider, model: responseModel, durationMs } = await invokeChatCompletion(requestPayload, { contextLabel: 'ui-generation' });
    
    lastCallMeta = {
      provider,
      model: responseModel,
      durationMs,
      usage: llmData?.usage || null,
      timestamp: nowIsoString(),
    };

    const responseMessage = llmData?.choices?.[0]?.message;
    if (!responseMessage) {
      console.error('[LLM] Response missing message payload.');
      uiDefinition = {
        type: 'container',
        children: [{ type: 'text', content: 'Error: LLM returned an empty response.' }],
      };
      break;
    }

    const parsedContent = parseAssistantContent(responseMessage.content);
    const toolCalls = Array.isArray(responseMessage.tool_calls) && responseMessage.tool_calls.length > 0
      ? responseMessage.tool_calls
      : Array.isArray(parsedContent?.tool_calls) ? parsedContent.tool_calls : [];

    if (toolCalls.length > 0) {
      console.log('[LLM] Tool calls requested:', toolCalls.map((call) => call.function?.name).filter(Boolean));
      messages.push({
        role: 'assistant',
        content: responseMessage.content || '',
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const toolName = toolCall?.function?.name;
        if (!toolName) {
          continue;
        }

        const toolDefinition = availableTools[toolName];
        if (!toolDefinition) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({ error: `Tool '${toolName}' unavailable.` }),
          });
          continue;
        }

        let args = {};
        const rawArguments = toolCall?.function?.arguments;
        if (typeof rawArguments === 'string' && rawArguments.trim().length > 0) {
          try {
            args = JSON.parse(rawArguments);
          } catch (error) {
            console.error(`[LLM] Failed to parse arguments for tool '${toolName}':`, error);
          }
        }

        const hasExplicitUrl = Boolean(toolDefinition.url);
        let serviceUrl = toolDefinition.url;
        if (!serviceUrl && toolDefinition.service) {
          try {
            const serviceResponse = await fetch(`${SERVICE_REGISTRY_URL}/services/${toolDefinition.service}`);
            if (!serviceResponse.ok) {
              throw new Error(`Registry responded with status ${serviceResponse.status}`);
            }
            const serviceRecord = await serviceResponse.json();
            serviceUrl = serviceRecord.url;
          } catch (error) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify({ error: `Unable to resolve service '${toolDefinition.service}': ${error.message}` }),
            });
            continue;
          }
        }

        if (!serviceUrl) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({ error: 'Tool endpoint not configured.' }),
          });
          continue;
        }

        const endpointPath = toolDefinition.path || toolDefinition.endpoint || '';
        const requestUrl = !hasExplicitUrl && endpointPath
          ? composeToolUrl(serviceUrl, endpointPath)
          : serviceUrl;
        const method = (toolDefinition.method || 'GET').toUpperCase();
        const headers = { ...(toolDefinition.headers || {}) };
        const requestInit = { method, headers };

        if (method !== 'GET') {
          headers['Content-Type'] = headers['Content-Type'] || 'application/json';
          requestInit.body = JSON.stringify(args || {});
        }

        console.log(`[LLM] Invoking tool '${toolName}' via ${method} ${requestUrl}`);

        let toolResult;
        try {
          const toolResponse = await fetch(requestUrl, requestInit);
          if (!toolResponse.ok) {
            const errorBody = await toolResponse.text();
            toolResult = { error: `Tool responded with status ${toolResponse.status}`, details: errorBody };
          } else {
            const responseText = await toolResponse.text();
            try {
              toolResult = JSON.parse(responseText);
            } catch {
              toolResult = { data: responseText };
            }
          }
        } catch (error) {
          console.error(`[LLM] Error invoking tool '${toolName}':`, error);
          toolResult = { error: error.message };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify(toolResult),
        });
      }

      toolInteractionOccurred = true;
      enforceSchema = true;

      if (!schemaReminderAdded) {
        messages.push({
          role: 'system',
          content: 'Tool responses received. Using these fresh results, respond next with a UI object that strictly matches the provided JSON schema.',
        });
        schemaReminderAdded = true;
      }

      continue;
    }

    if (availableToolNames.length > 0 && !toolInteractionOccurred) {
      attemptsWithoutTool += 1;
      
      if (attemptsWithoutTool <= maxAttemptsWithoutTool) {
        messages.push({
          role: 'system',
          content: 'You must call at least one available tool to fetch real-time data before finalizing the UI. Do not guess values—call a tool now.',
        });
        enforceSchema = false;
        continue;
      }
      
      enforceSchema = true;
    }

    if (!parsedContent || Object.keys(parsedContent).length === 0) {
      console.error('[LLM] Parsed assistant content is empty.');
      uiDefinition = {
        type: 'container',
        children: [{ type: 'text', content: 'Error: LLM response was empty after tool usage.' }],
      };
    } else {
      uiDefinition = parsedContent;
    }
    break;
  }

  if (preferLargeTapTargets && uiDefinition && typeof uiDefinition === 'object' && !Array.isArray(uiDefinition)) {
    if (!uiDefinition.context || typeof uiDefinition.context !== 'object' || Array.isArray(uiDefinition.context)) {
      uiDefinition.context = {};
    }

    if (!uiDefinition.context.defaultErgonomicsProfile) {
      uiDefinition.context.defaultErgonomicsProfile = LARGE_TAP_TARGET_PROFILE;
    }
  }

  return { uiDefinition, meta: lastCallMeta };
}
