import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PORT = Number.parseInt(process.env.KNOWLEDGE_BASE_PORT || '3005', 10);
export const LISTEN_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';
export const SERVICE_REGISTRY_URL = process.env.SERVICE_REGISTRY_URL || 'http://core-system:3000';
export const PUBLIC_URL = process.env.KNOWLEDGE_BASE_PUBLIC_URL || `http://knowledge-base:${PORT}`;

// LLM Configuration
export const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'http://host.docker.internal:1234/v1/chat/completions';
export const LLM_DEFAULT_MODEL = process.env.LLM_MODEL || 'gemma 3b';
export const OPEN_ROUTER_API_KEY = process.env.OPENROUTER_API_KEY || null;
export const OPEN_ROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
export const OPEN_ROUTER_MODEL = process.env.OPENROUTER_MODEL || null;
export const OPEN_ROUTER_REFERER = process.env.OPENROUTER_APP_URL || process.env.OPENROUTER_REFERER || null;
export const OPEN_ROUTER_TITLE = process.env.OPENROUTER_APP_NAME || process.env.OPENROUTER_TITLE || 'IMP Requirements KB';
export const OPEN_ROUTER_REASONING_EFFORT = process.env.OPENROUTER_REASONING_EFFORT || null;

// Paths
// config.js is in /src, so we go up one level to reach package root
export const PACKAGE_ROOT = path.resolve(__dirname, '..');
export const DATA_FILE = process.env.KNOWLEDGE_BASE_DATA_FILE
  ? path.resolve(process.env.KNOWLEDGE_BASE_DATA_FILE)
  : path.join(PACKAGE_ROOT, 'kb-data.json');

export const LLM_LOG_DIR = process.env.KB_LLM_LOG_DIR
  ? path.resolve(process.env.KB_LLM_LOG_DIR)
  : path.join(PACKAGE_ROOT, 'logs');

export const CORE_OUTPUT_SCHEMA_PATH = path.join(PACKAGE_ROOT, '../core-system/output.schema.json');
