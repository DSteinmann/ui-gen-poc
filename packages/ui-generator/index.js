import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
app.use(express.json()); // Enable JSON body parsing

app.use(cors()); // Enable CORS for all origins (for debugging)

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const port = 3001;

app.get('/', (req, res) => {
  res.send('UI Generator');
});

// LLM integration
app.post('/generate-ui', async (req, res) => {
  const { prompt, thingDescription, capabilities } = req.body;
  console.log(`Received prompt: ${prompt}, Capabilities: ${capabilities}`);

  const messages = [
    {
      role: 'system',
      content: `You are a UI generator. Based on the user's prompt, the provided thing description (if any), and the available UI capabilities, generate a JSON object that describes the UI. The UI should be composed of 'container', 'text', 'button', 'input', and 'toggle' elements. Only use the provided capabilities. If a capability is not provided, do not use it. For a light switch, if 'toggle' is available, use it. Otherwise, use a 'button'. The JSON should be directly parsable and not wrapped in markdown. Available capabilities: ${capabilities.join(', ')}. Thing Description: ${JSON.stringify(thingDescription)}`,
    },
    { role: 'user', content: prompt },
  ];

  try {
    const llmResponse = await fetch('http://localhost:1234/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gemma 3b', // Updated to gemma 3b
        messages: messages,
        temperature: 0.7,
      }),
    });

    const llmData = await llmResponse.json();
    const llmGeneratedContent = llmData.choices[0].message.content;
    console.log('LLM Raw Response:', llmGeneratedContent);

    let generatedUi = {};
    try {
      // Handle potential markdown code block
      const jsonRegex = /```json\n([\s\S]*?)\n```/;
      const match = llmGeneratedContent.match(jsonRegex);
      if (match && match[1]) {
        generatedUi = JSON.parse(match[1]);
      } else {
        generatedUi = JSON.parse(llmGeneratedContent);
      }
    } catch (parseError) {
      console.error('Error parsing LLM response as JSON:', parseError);
      generatedUi = {
        type: 'container',
        children: [
          { type: 'text', content: 'Error: LLM did not return valid JSON.' },
          { type: 'text', content: llmGeneratedContent },
        ],
      };
    }

    // Send generated UI to all connected WebSocket clients
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(generatedUi));
      }
    });

    res.json({ status: 'UI generated and sent' });
  } catch (error) {
    console.error('Error communicating with LLM:', error);
    res.status(500).json({ error: 'Failed to generate UI with LLM', details: error.message });
  }
});

wss.on('connection', (ws) => {
  console.log('Client connected');
  const uiDefinition = {
    type: 'container',
    children: [
      { type: 'text', content: 'Hello from the UI Generator!' },
      { type: 'button', label: 'Click me' },
    ],
  };
  ws.send(JSON.stringify(uiDefinition));

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

server.listen(port, () => {
  console.log(`UI Generator listening at http://localhost:${port}`);
});
