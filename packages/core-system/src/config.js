import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PORT = Number.parseInt(process.env.CORE_SYSTEM_PORT || '3001', 10);
export const REGISTRY_PORT = Number.parseInt(process.env.SERVICE_REGISTRY_PORT || '3000', 10);
export const UI_REFRESH_INTERVAL_MS = 60000;
export const FALLBACK_PROMPT = 'Analyze the registered devices, their schemas, and capabilities. Select the best-suited target automatically, then design a responsive UI with clear state feedback and appropriate theming cues for the referenced thing.';
export const CORE_PUBLIC_URL = process.env.CORE_SYSTEM_PUBLIC_URL || `http://core-system:${PORT}`;
export const REGISTRY_PUBLIC_URL = process.env.SERVICE_REGISTRY_PUBLIC_URL || `http://core-system:${REGISTRY_PORT}`;
export const SERVICE_REGISTRY_URL = process.env.SERVICE_REGISTRY_URL || REGISTRY_PUBLIC_URL;
export const KNOWLEDGE_BASE_URL = process.env.KNOWLEDGE_BASE_URL || 'http://knowledge-base:3005';
export const LISTEN_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';

// We are in packages/core-system/src/config.js, so root is ..
export const PACKAGE_ROOT = path.resolve(__dirname, '..');
export const PROMPTS_DIR = path.resolve(PACKAGE_ROOT, 'prompts');
export const DEFAULT_RESPONSE_SCHEMA_PATH = path.resolve(PACKAGE_ROOT, 'output.schema.json');
