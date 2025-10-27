import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json());
app.use(cors());
const port = 3005;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '../core-system/output.schema.json'), 'utf-8'));

const DATA_FILE = path.join(__dirname, 'kb-data.json');

const nowIsoString = () => new Date().toISOString();

const ensureDataFile = () => {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ documents: [] }, null, 2), 'utf-8');
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

  const existingIndex = documents.findIndex((doc) => doc.id === docId);
  if (existingIndex !== -1) {
    documents[existingIndex] = record;
  } else {
    documents.push(record);
  }

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

const registerWithServiceRegistry = async () => {
  try {
    await fetch('http://localhost:3000/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'knowledge-base',
        url: `http://localhost:${port}`,
      })
    });
    console.log('Registered with service registry');
  } catch (error) {
    console.error('Error registering with service registry:', error);
  }
};

async function runAgent({ prompt, thingDescription, capabilities = [], uiSchema = {}, capabilityData, missingCapabilities, device, deviceId }) {
  console.log('[KB] runAgent invoked', {
    deviceId: deviceId || null,
    capabilitiesCount: Array.isArray(capabilities) ? capabilities.length : 0,
    hasSchema: Boolean(uiSchema && Object.keys(uiSchema).length),
  });
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

  // Filter definitions based on available components
  for (const key in filteredSchema.definitions) {
    if (key.endsWith('Component') && !availableComponentNames.includes(key.replace('Component', ''))) {
      delete filteredSchema.definitions[key];
    }
  }

  if (filteredSchema.definitions.component && filteredSchema.definitions.component.oneOf) {
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
      if (filteredSchema.definitions.component && filteredSchema.definitions.component.oneOf) {
        filteredSchema.definitions.component.oneOf = filteredSchema.definitions.component.oneOf.filter((ref) => ref.$ref !== '#/definitions/toolCall');
      }
    }
  }

  const tools = Object.entries(availableTools).map(([name, tool]) => ({
    type: 'function',
    function: {
      name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  }));

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
      content:
        'The device supports theming through the root `theme.primaryColor` field. When requirements or preferences mention a specific color (hex value), set `theme.primaryColor` accordingly to personalize the interface, while keeping sufficient contrast for readability.',
    });
  }

  const userContext = {
    prompt,
    thingDescription,
    deviceId,
    device,
    capabilityData,
    missingCapabilities,
  };

  messages.push({
    role: 'user',
    content: JSON.stringify(userContext, null, 2),
  });

  let uiDefinition;

  while (true) {
    console.log('[KB] Invoking LLM endpoint http://192.168.1.73:1234/v1/chat/completions with model', uiSchema.model || 'gemma 3b');
    const llmResponse = await fetch('http://192.168.1.73:1234/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: uiSchema.model || 'gemma 3b',
        messages,
        temperature: 0.7,
        tools,
        tool_choice: 'auto',
        response_format: {
          type: 'json_schema',
          json_schema: {
            schema: filteredSchema,
          },
        },
      }),
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      console.error(`[KB] LLM endpoint responded with status ${llmResponse.status}: ${errorText}`);
      throw new Error(`LLM endpoint error ${llmResponse.status}`);
    }

    const llmData = await llmResponse.json();
    console.log('LLM Data:', llmData);

    if (!llmData.choices || llmData.choices.length === 0) {
      console.error('LLM returned no choices.');
      uiDefinition = {
        type: 'container',
        children: [
          { type: 'text', content: 'Error: LLM returned no choices.' },
        ],
      };
      break;
    }

    const llmJson = JSON.parse(llmData.choices[0].message.content);
    console.log('LLM Raw Response:', llmJson);

    if (llmJson.tool_calls) {
      const { tool_calls } = llmJson;
      for (const toolCall of tool_calls) {
        const { function: { name } } = toolCall;
        console.log(`Calling tool: ${name}`);

        try {
          if (!uiSchema.name) {
            throw new Error('Schema name missing; cannot resolve tool endpoint.');
          }

    console.log(`[KB] Resolving tool '${name}' for service ${uiSchema.name}`);
    const serviceResponse = await fetch(`http://localhost:3000/services/${uiSchema.name}`);
          const service = await serviceResponse.json();
    console.log(`[KB] Tool '${name}' resolved at ${service.url}`);
          const toolResponse = await fetch(`${service.url}/${name}`);

          const toolResult = await toolResponse.json();
          messages.push({ role: 'assistant', content: JSON.stringify(llmJson) });
          messages.push({ role: 'tool', tool_call_id: toolCall.id, name, content: JSON.stringify(toolResult) });
        } catch (error) {
          console.error('Error calling tool:', error);
          messages.push({ role: 'tool', tool_call_id: toolCall.id, name, content: JSON.stringify({ error: error.message }) });
        }
      }
    } else {
      uiDefinition = llmJson;
      break;
    }
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

app.listen(port, () => {
  console.log(`Requirement Knowledge Base listening at http://localhost:${port}`);
  ensureDataFile();
  registerWithServiceRegistry();
});
