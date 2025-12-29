// Knowledge base orchestrates requirement retrieval plus guarded LLM calls for UI generation and device selection.
import express from 'express';
import cors from 'cors';
import { PORT, LISTEN_ADDRESS, PUBLIC_URL } from './src/config.js';
import { seedKnowledgeBase, loadDocuments } from './src/store.js';
import router from './src/routes.js';
import { registerWithServiceRegistry } from './src/service.js';

const app = express();
app.use(express.json());
app.use(cors());

app.use('/', router);

app.listen(PORT, LISTEN_ADDRESS, () => {
  console.log(`Requirement Knowledge Base listening at ${LISTEN_ADDRESS}:${PORT} (public URL: ${PUBLIC_URL})`);
  loadDocuments();
  seedKnowledgeBase();
  registerWithServiceRegistry();
});
