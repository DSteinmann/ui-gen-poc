import fetch from 'node-fetch';
import { SERVICE_REGISTRY_URL, PUBLIC_URL } from './config.js';

export const registerWithServiceRegistry = async () => {
  try {
    await fetch(`${SERVICE_REGISTRY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'knowledge-base',
        url: PUBLIC_URL,
        type: 'generic',
        metadata: {
          service: 'knowledge-base',
          description: 'RAG-powered requirement knowledge base with device selection support.',
        },
      }),
    });
    console.log('[Registry] Registered with service registry.');
  } catch (error) {
    console.error('[Registry] Failed to register with service registry:', error.message);
  }
};
