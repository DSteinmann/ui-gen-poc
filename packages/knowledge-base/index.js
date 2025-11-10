import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json());
app.use(cors());
const port = Number.parseInt(process.env.KNOWLEDGE_BASE_PORT || '3005', 10);
const listenAddress = process.env.BIND_ADDRESS || '0.0.0.0';
const serviceRegistryUrl = process.env.SERVICE_REGISTRY_URL || 'http://localhost:3000';
const knowledgeBasePublicUrl = process.env.KNOWLEDGE_BASE_PUBLIC_URL || `http://localhost:${port}`;
const llmEndpoint = process.env.LLM_ENDPOINT || 'http://localhost:1234/v1/chat/completions';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '../core-system/output.schema.json'), 'utf-8'));

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

const DATA_FILE = process.env.KNOWLEDGE_BASE_DATA_FILE
  ? path.resolve(process.env.KNOWLEDGE_BASE_DATA_FILE)
  : path.join(__dirname, 'kb-data.json');

const nowIsoString = () => new Date().toISOString();

const ensureDataFile = () => {
  const dataDir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ documents: [] }, null, 2), 'utf-8');
  }
};

const registerWithServiceRegistry = async () => {
  try {
    await fetch(`${serviceRegistryUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'knowledge-base',
        url: knowledgeBasePublicUrl,
        type: 'generic',
        metadata: {
          service: 'knowledge-base',
          description: 'RAG-powered requirement knowledge base with device selection support.',
        },
      }),
    });
  console.log('[KB] Registered with service registry.');
  } catch (error) {
    console.error('[KB] Failed to register with service registry:', error.message);
  }
};

const tokenize = (text = '') =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const buildTermFrequency = (tokens = []) =>
  tokens.reduce((acc, token) => {
    acc[token] = (acc[token] || 0) + 1;
    return acc;
  }, {});

const cosineSimilarity = (vectorA, vectorB) => {
  const uniqueTokens = new Set([...Object.keys(vectorA), ...Object.keys(vectorB)]);
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  uniqueTokens.forEach((token) => {
    const a = vectorA[token] || 0;
    const b = vectorB[token] || 0;
    dotProduct += a * b;
    magnitudeA += a * a;
    magnitudeB += b * b;
  });

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
};

const loadDocuments = () => {
  ensureDataFile();
  const content = fs.readFileSync(DATA_FILE, 'utf-8');
  const parsed = JSON.parse(content);
  return Array.isArray(parsed.documents) ? parsed.documents : [];
};

const persistDocuments = (docs) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ documents: docs }, null, 2), 'utf-8');
};

const documents = loadDocuments();

const addDocument = ({ id, content, metadata = {}, tags = [] }) => {
  if (!content || typeof content !== 'string') {
    throw new Error('Document `content` must be a non-empty string.');
  }

  const docId = id || `doc-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const tokens = tokenize(content);
  const termFrequency = buildTermFrequency(tokens);

  const record = {
    id: docId,
    content,
    metadata,
    tags,
    tokens,
    termFrequency,
    updatedAt: nowIsoString(),
    createdAt:
      documents.find((doc) => doc.id === docId)?.createdAt || nowIsoString(),
  };

  persistDocuments(documents);
  return record;
};

const seedDocuments = [
  {
    id: 'modality-guideline-hands-occupied',
    content:
      'When the user activity sensor reports the state "hands-occupied", prefer audio-first guidance. Provide spoken prompts and minimize the need for direct touch input. When the sensor reports "hands-free", present tactile controls such as buttons or toggles for the light switch.',
    metadata: {
      source: 'safety-guidelines',
      version: '1.0.0',
    },
    tags: ['modality', 'hands-occupied', 'audio', 'light-switch'],
  },
  {
    id: 'user-preference-primary-color',
    content:
      'The primary household preference for interface accents is the color "#1F6FEB" (a vivid cobalt). Whenever possible, set the UI theme primary color to this value so buttons, toggles, and other interactive highlights align with the user preference. Ensure sufficient contrast by using light text on dark backgrounds.',
    metadata: {
      source: 'user-profile',
      version: '2025.10',
    },
    tags: ['preference', 'theme', 'primary-color', 'personalization'],
  },
];

const seedKnowledgeBase = () => {
  seedDocuments.forEach((doc) => {
    if (!documents.some((entry) => entry.id === doc.id)) {
      addDocument(doc);
      console.log(`Seeded knowledge base document: ${doc.id}`);
    }
  });
};

seedKnowledgeBase();

const retrieveRelevantDocuments = ({ prompt, thingDescription, capabilityData, capabilities, missingCapabilities, device, uiContext }) => {
  if (!documents.length) return [];

  const querySegments = [];

  if (prompt) querySegments.push(prompt);
  if (thingDescription) {
    querySegments.push(
      typeof thingDescription === 'string' ? thingDescription : JSON.stringify(thingDescription)
    );
  }
  if (capabilityData && Object.keys(capabilityData).length > 0) {
    querySegments.push(JSON.stringify(capabilityData));
  }
  if (Array.isArray(capabilities) && capabilities.length > 0) {
    querySegments.push(`capabilities: ${capabilities.join(', ')}`);
  }
  if (Array.isArray(missingCapabilities) && missingCapabilities.length > 0) {
    querySegments.push(`missing: ${missingCapabilities.join(', ')}`);
  }
  if (device) {
    querySegments.push(JSON.stringify({ device }));
  }
  if (uiContext) {
    querySegments.push(JSON.stringify(uiContext));
  }

  const query = querySegments.filter(Boolean).join('\n');
  const queryTokens = tokenize(query);
  const queryVector = buildTermFrequency(queryTokens);

  if (Object.keys(queryVector).length === 0) {
    return [];
  }

  const scoredDocuments = documents
    .map((doc) => ({
      score: cosineSimilarity(queryVector, doc.termFrequency || {}),
      document: doc,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ score, document }) => ({
      ...document,
      score,
    }));

  return scoredDocuments;
};

const runDeviceSelection = async ({
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
        `Supports theming: ${Array.isArray(candidate.metadata?.supportsTheming) ? candidate.metadata.supportsTheming.join(', ') : 'no'}`,
        `Capability match: ${matchSummary}`,
      ];

      return `Candidate ${index + 1}: ${candidate.name} (${candidate.id})\n${features.join('\n')}`;
    }).join('\n\n');

    const retrievedDocuments = retrieveRelevantDocuments({
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

    const requestBody = {
      model: model || 'gemma 3b',
      messages: selectionMessages,
      temperature: 0.3,
      response_format: {
        type: 'json_schema',
        json_schema: { schema: deviceSelectionJsonSchema },
      },
    };

  const response = await fetch(llmEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[KB] Device selection endpoint responded with status ${response.status}: ${errorText}`);
      throw new Error(`Device selection LLM error ${response.status}`);
    }

    const data = await response.json();
    const selectionMessage = data?.choices?.[0]?.message;
    if (!selectionMessage?.content) {
      throw new Error('Device selection LLM returned an empty response.');
    }

    let parsed;
    try {
      parsed = typeof selectionMessage.content === 'string'
        ? JSON.parse(selectionMessage.content)
        : Array.isArray(selectionMessage.content)
          ? selectionMessage.content[0]
          : selectionMessage.content;
    } catch (error) {
      console.error('[KB] Failed to parse device selection content:', error);
      throw new Error('Unable to parse device selection response.');
    }

    console.log(`[KB] Device selection chose '${parsed?.targetDeviceId || 'unknown'}' with confidence ${parsed?.confidence || 'unspecified'}.`);

    return parsed;
  };

async function runAgent({ prompt, thingDescription, capabilities = [], uiSchema = {}, capabilityData, missingCapabilities, device, deviceId, selection }) {
  const availableComponents = uiSchema.components || {};
  const availableComponentNames = Object.keys(availableComponents);
  const availableTools = uiSchema.tools || {};
  const availableToolNames = Object.keys(availableTools);

  const filteredSchema = JSON.parse(JSON.stringify(outputSchema));

  const retrievedDocuments = retrieveRelevantDocuments({
    prompt,
    thingDescription,
    capabilityData,
    capabilities,
    missingCapabilities,
    device,
    uiContext: uiSchema.context,
  });

  if (retrievedDocuments.length) {
    console.log('Retrieved documents for context:', retrievedDocuments.map((doc) => `${doc.id} (score ${doc.score.toFixed(3)})`));
  }

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
  };

  messages.push({
    role: 'user',
    content: JSON.stringify(userContext, null, 2),
  });

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
    try {
      return JSON.parse(content);
    } catch (error) {
      console.error('[KB] Failed to parse assistant content as JSON:', error);
      return null;
    }
  };

  let uiDefinition;
  let toolInteractionOccurred = false;
  let schemaReminderAdded = false;
  let attemptsWithoutTool = 0;
  const maxAttemptsWithoutTool = 2;
  let enforceSchema = availableToolNames.length === 0;

  while (true) {
    const requestPayload = {
      model: uiSchema.model || 'gemma 3b',
      messages,
      temperature: 0.7,
    };

    if (toolDefinitions.length > 0) {
      requestPayload.tools = toolDefinitions;
      requestPayload.tool_choice = 'auto';
    }

    if (enforceSchema) {
      requestPayload.response_format = {
        type: 'json_schema',
        json_schema: { schema: filteredSchema },
      };
    }

  console.log('[KB] Invoking LLM endpoint', llmEndpoint, 'with model', requestPayload.model, 'schema enforced?', enforceSchema);

  const llmResponse = await fetch(llmEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      console.error(`[KB] LLM endpoint responded with status ${llmResponse.status}: ${errorText}`);
      throw new Error(`LLM endpoint error ${llmResponse.status}`);
    }

    const llmData = await llmResponse.json();
    console.log('LLM Data:', llmData);

    const responseMessage = llmData?.choices?.[0]?.message;
    if (!responseMessage) {
      console.error('[KB] LLM response missing message payload.');
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
      console.log('[KB] Tool calls requested:', toolCalls.map((call) => call.function?.name).filter(Boolean));
      messages.push({
        role: 'assistant',
        content: responseMessage.content || '',
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const toolName = toolCall?.function?.name;
        if (!toolName) {
          console.warn('[KB] Tool call missing function name, skipping.');
          continue;
        }

        const toolDefinition = availableTools[toolName];
        if (!toolDefinition) {
          console.error(`[KB] Tool '${toolName}' not defined in schema.`);
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
            console.error(`[KB] Failed to parse arguments for tool '${toolName}':`, error);
          }
        }

        let serviceUrl = toolDefinition.url;
        if (!serviceUrl && toolDefinition.service) {
          try {
            const serviceResponse = await fetch(`${serviceRegistryUrl}/services/${toolDefinition.service}`);
            if (!serviceResponse.ok) {
              throw new Error(`Registry responded with status ${serviceResponse.status}`);
            }
            const serviceRecord = await serviceResponse.json();
            serviceUrl = serviceRecord.url;
          } catch (error) {
            console.error(`[KB] Failed to resolve service '${toolDefinition.service}' for tool '${toolName}':`, error);
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
          console.error(`[KB] No service URL configured for tool '${toolName}'.`);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({ error: 'Tool endpoint not configured.' }),
          });
          continue;
        }

        const endpointPath = toolDefinition.path || toolDefinition.endpoint || '';
        const requestUrl = composeToolUrl(serviceUrl, endpointPath);
        const method = (toolDefinition.method || 'GET').toUpperCase();
        const headers = { ...(toolDefinition.headers || {}) };
        const requestInit = { method, headers };

        if (method !== 'GET') {
          headers['Content-Type'] = headers['Content-Type'] || 'application/json';
          requestInit.body = JSON.stringify(args || {});
        }

        console.log(`[KB] Invoking tool '${toolName}' via ${method} ${requestUrl}`);

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
          console.error(`[KB] Error invoking tool '${toolName}':`, error);
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
      console.warn(`[KB] No tool call detected despite available tools (attempt ${attemptsWithoutTool}).`);

      if (attemptsWithoutTool <= maxAttemptsWithoutTool) {
        messages.push({
          role: 'system',
          content: 'You must call at least one available tool (for example, getUserActivity) to fetch real-time data before finalizing the UI. Do not guess values—call a tool now.',
        });
        enforceSchema = false;
        continue;
      }

      console.warn('[KB] Proceeding without tool execution after maximum retries.');
      enforceSchema = true;
    }

    if (!parsedContent || Object.keys(parsedContent).length === 0) {
      console.error('[KB] Parsed assistant content is empty.');
      uiDefinition = {
        type: 'container',
        children: [{ type: 'text', content: 'Error: LLM response was empty after tool usage.' }],
      };
    } else {
      uiDefinition = parsedContent;
    }
    break;
  }

  return uiDefinition;
}

app.get('/documents', (req, res) => {
  res.json({ count: documents.length, documents });
});

app.post('/documents', (req, res) => {
  try {
    const { id, content, metadata, tags } = req.body;
    const record = addDocument({ id, content, metadata, tags });
    res.status(201).json({ status: 'stored', document: record });
  } catch (error) {
    console.error('Error storing document:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/select-device', async (req, res) => {
  const {
    prompt,
    fallbackPrompt,
    desiredCapabilities,
    thingDescription,
    candidates,
    model,
  } = req.body || {};

  try {
    const selection = await runDeviceSelection({
      prompt,
      fallbackPrompt,
      desiredCapabilities,
      thingDescription,
      candidates,
      model,
    });
    res.json(selection);
  } catch (error) {
    console.error('[KB] Device selection failed:', error);
    res.status(500).json({ error: 'Device selection failed', details: error.message });
  }
});

app.post('/query', async (req, res) => {
  const { prompt, thingDescription, capabilities, schema, capabilityData, missingCapabilities, device, deviceId } = req.body;
  console.log('[KB] /query invoked', {
    promptPreview: typeof prompt === 'string' ? `${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}` : null,
    capabilities,
    deviceId: deviceId || null,
  });

  try {
    let generatedUi = await runAgent({
      prompt,
      thingDescription,
      capabilities,
      uiSchema: schema || {},
      capabilityData,
      missingCapabilities,
      device,
      deviceId,
    });

    if (!generatedUi || Object.keys(generatedUi).length === 0) {
      generatedUi = {
        type: 'container',
        children: [
          { type: 'text', content: 'Error: UI generation failed. The generated UI is empty.' },
        ],
      };
    }
    console.log('[KB] Returning generated UI payload.');
    res.json(generatedUi);
  } catch (error) {
    console.error('Error communicating with LLM:', error);
    res.status(500).json({ error: 'Failed to generate UI with LLM', details: error.message });
  }
});

app.listen(port, listenAddress, () => {
  console.log(`Requirement Knowledge Base listening at ${listenAddress}:${port} (public URL: ${knowledgeBasePublicUrl})`);
  ensureDataFile();
  registerWithServiceRegistry();
});
