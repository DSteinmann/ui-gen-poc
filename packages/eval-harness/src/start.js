#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const loadEnvFile = (candidatePath) => {
  try {
    const result = dotenv.config({ path: candidatePath });
    if (result.error) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
};

const envLoaded =
  loadEnvFile(path.join(repoRoot, '.env'))
  || loadEnvFile(path.join(repoRoot, '.env.local'))
  || loadEnvFile(path.join(repoRoot, '.env.example'));

if (!envLoaded) {
  console.warn('⚠️  Could not load a .env file. Falling back to existing process environment.');
}

const hasFlag = (flagName, argv) => {
  const longForm = `--${flagName}`;
  return argv.some((arg, index) => arg === longForm || arg.startsWith(`${longForm}=`));
};

const appendFlag = (argv, flagName, value) => {
  if (!value || hasFlag(flagName, argv)) {
    return argv;
  }
  return argv.concat(`--${flagName}`, value);
};

const resolveDefault = () => ({
  endpoint: process.env.EVAL_LLM_ENDPOINT || process.env.LLM_ENDPOINT || 'http://localhost:1234/v1/chat/completions',
  model: process.env.EVAL_LLM_MODEL || process.env.LLM_MODEL || 'gpt-4.1-mini',
  apiKey: process.env.EVAL_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '',
  provider:
    process.env.EVAL_PROVIDER
    || (process.env.OPENROUTER_API_KEY ? 'openrouter' : process.env.OPENAI_API_KEY ? 'openai' : 'local'),
  kbUrl: process.env.EVAL_KB_URL || process.env.KNOWLEDGE_BASE_PUBLIC_URL || process.env.KNOWLEDGE_BASE_URL || 'http://localhost:3005',
});

const userArgs = process.argv.slice(2);
const defaults = resolveDefault();
let finalArgs = userArgs.slice();
finalArgs = appendFlag(finalArgs, 'endpoint', defaults.endpoint);
finalArgs = appendFlag(finalArgs, 'model', defaults.model);
finalArgs = appendFlag(finalArgs, 'provider', defaults.provider);
finalArgs = appendFlag(finalArgs, 'kb-url', defaults.kbUrl);

if (defaults.apiKey && !process.env.EVAL_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
  process.env.EVAL_API_KEY = defaults.apiKey;
}

const cliPath = path.resolve(__dirname, 'cli.js');
const child = spawn('node', [cliPath, ...finalArgs], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});