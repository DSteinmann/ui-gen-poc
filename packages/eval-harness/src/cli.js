#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { performance } from 'node:perf_hooks';
import { Command } from 'commander';
import chalk from 'chalk';
import { Buffer } from 'buffer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SUITE_PATH = path.resolve(__dirname, '..', '..', 'knowledge-base', 'eval-suite.json');
const DEFAULT_KB_DATA_PATH = path.resolve(__dirname, '..', '..', 'knowledge-base', 'kb-data.json');
const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, '..', '..', 'tablet-device', 'schema.json');
const DEFAULT_KB_URL = process.env.EVAL_KB_URL || process.env.KNOWLEDGE_BASE_URL || process.env.KNOWLEDGE_BASE_PUBLIC_URL || null;
const EVAL_MODES = new Set(['chat', 'kb']);
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'results');

const FALLBACK_DOCUMENTS = [
  {
    id: 'modality-guideline-hands-occupied',
    content:
      'When the user activity sensor reports the state "hands-occupied", prefer audio-first guidance. Provide spoken prompts and minimize the need for direct touch input. When the sensor reports "hands-free", present tactile controls such as buttons or toggles for the light switch.',
    metadata: { source: 'safety-guidelines', version: '1.0.0' },
    tags: ['modality', 'hands-occupied', 'audio', 'light-switch'],
  },
  {
    id: 'user-preference-primary-color',
    content:
      'The primary household preference for interface accents is the color "#1E90FF" (a grey). Whenever possible, set the UI theme primary color to this value so buttons, toggles, and other interactive highlights align with the user preference. Ensure sufficient contrast by using light text on dark backgrounds.',
    metadata: { source: 'user-profile', version: '2025.10' },
    tags: ['preference', 'theme', 'primary-color', 'personalization'],
  },
];

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const readJsonFile = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`Unable to read JSON file at ${filePath}: ${error.message}`);
  }
};

const tryReadJsonFile = (filePath) => {
  try {
    return readJsonFile(filePath);
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Unable to read JSON file ${filePath}: ${error.message}`));
    return null;
  }
};

const fetchDocumentsFromService = async (kbUrl) => {
  if (!kbUrl) {
    return null;
  }

  const normalized = kbUrl.endsWith('/') ? kbUrl.slice(0, -1) : kbUrl;
  const endpoint = `${normalized}/documents`;

  try {
    const response = await fetch(endpoint, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const docs = Array.isArray(payload.documents) ? payload.documents : [];
    console.log(chalk.gray(`Pulled ${docs.length} documents from ${endpoint}.`));
    return docs;
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Failed to fetch documents from ${endpoint}: ${error.message}`));
    return null;
  }
};

const fetchKbLlmConfig = async (kbUrl) => {
  if (!kbUrl) {
    return null;
  }

  const normalized = kbUrl.endsWith('/') ? kbUrl.slice(0, -1) : kbUrl;
  const endpoint = `${normalized}/llm-config`;

  try {
    const response = await fetch(endpoint, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    console.log(chalk.gray(`KB reports provider=${payload.provider || 'unknown'} model=${payload.model || 'n/a'}.`));
    return payload;
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Could not fetch KB LLM config from ${endpoint}: ${error.message}`));
    return null;
  }
};

const loadKnowledgeDocuments = async ({ kbDataPath, kbUrl }) => {
  let docs = [];

  if (kbUrl) {
    const remoteDocs = await fetchDocumentsFromService(kbUrl);
    if (Array.isArray(remoteDocs) && remoteDocs.length) {
      docs = remoteDocs;
    }
  }

  if (!docs.length) {
    let parsed = {};
    try {
      parsed = readJsonFile(kbDataPath);
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Could not load KB data file (${error.message}). Falling back to built-in seed documents.`));
    }
    docs = Array.isArray(parsed.documents) ? parsed.documents : [];
  }

  const docMap = new Map(docs.map((doc) => [doc.id, doc]));
  FALLBACK_DOCUMENTS.forEach((doc) => {
    if (!docMap.has(doc.id)) {
      docMap.set(doc.id, doc);
    }
  });
  return docMap;
};

const buildPrompt = (scenario, documentsById) => {
  const docEntries = (scenario.sourceDocuments || [])
    .map((docId) => {
      const doc = documentsById.get(docId);
      if (!doc) {
        return `Document ${docId}: NOT FOUND.`;
      }
      const source = doc.metadata?.source || 'knowledge-base';
      return `Document ${docId} (source: ${source}):\n${doc.content.trim()}`;
    })
    .filter(Boolean);

  const docSections = docEntries.length
    ? docEntries.join('\n\n')
    : 'No explicit documents provided; rely on general KB constraints (theme + modality).';

  const inputsBlock = scenario.inputs ? JSON.stringify(scenario.inputs, null, 2) : 'None provided';
  const required = scenario.expected?.requiredBehaviors?.length
    ? `Required behaviors:\n- ${scenario.expected.requiredBehaviors.join('\n- ')}`
    : 'Required behaviors: adhere to the documents above.';
  const avoid = scenario.failureSignals?.length
    ? `Avoid the following failure modes:\n- ${scenario.failureSignals.join('\n- ')}`
    : 'Avoid contradicting any document guidance.';

  return (
    `You are a UI planning assistant for a tablet experience. `
    + `Use the provided requirement documents to craft a response that explains what the tablet should render or say. `
    + `Always cite the relevant document ids in parentheses when referencing a guideline.\n\n`
    + `${docSections}\n\n`
    + `Scenario prompt: ${scenario.prompt}\n\n`
    + `Context inputs:\n${inputsBlock}\n\n`
    + `${required}\n\n`
    + `${avoid}\n\n`
    + 'Respond with two sections: (1) "Plan" — short paragraphs describing the approach, (2) "Checks" — bullet list referencing document ids.'
  );
};

const detectFailureSignals = (answer, failureSignals = []) => {
  if (!answer) {
    return [];
  }
  const normalized = answer.toLowerCase();
  return failureSignals.filter((signal) => {
    if (!signal) return false;
    return normalized.includes(signal.toLowerCase());
  });
};

const buildKnowledgeBasePayload = (scenario, { uiSchema }) => {
  const deviceId = 'device-tablet-eval';
  return {
    prompt: scenario.prompt,
    schema: uiSchema || {},
    capabilityData: scenario.inputs || {},
    uiContext: {
      scenarioId: scenario.id,
      tags: scenario.tags || [],
      inputs: scenario.inputs || {},
    },
    deviceId,
    device: {
      id: deviceId,
      deviceId,
      label: 'Evaluation Tablet',
      type: 'tablet',
      ergonomicsProfile: 'cozy-desktop',
    },
  };
};

const callKnowledgeBase = async ({ kbUrl, payload }) => {
  if (!kbUrl) {
    throw new Error('Knowledge base URL is required when running in kb mode.');
  }

  const base = kbUrl.endsWith('/') ? kbUrl.slice(0, -1) : kbUrl;
  const endpoint = `${base}/query`;
  const start = performance.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const durationMs = performance.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`KB request failed (${response.status}): ${errorText}`);
  }

  let llmMeta = null;
  const metaHeader = response.headers.get('x-kb-llm-meta');
  if (metaHeader) {
    try {
      const decoded = Buffer.from(metaHeader, 'base64').toString('utf-8');
      llmMeta = JSON.parse(decoded);
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Unable to parse KB LLM metadata: ${error.message}`));
    }
  }

  const data = await response.json();
  const answer = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { data, answer, durationMs, llmMeta };
};

const callChatCompletion = async ({ endpoint, model, apiKey, provider, prompt }) => {
  const systemMessage = {
    role: 'system',
    content:
      'You are a meticulous interaction planner. Stay concise (under 250 words) and cite knowledge-base document ids like (modality-guideline-hands-occupied).',
  };

  const body = {
    model,
    messages: [systemMessage, { role: 'user', content: prompt }],
  };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (provider === 'openrouter') {
    const referer = process.env.OPENROUTER_APP_URL || process.env.OPENROUTER_REFERER;
    const title = process.env.OPENROUTER_APP_NAME || process.env.OPENROUTER_TITLE || 'Eval Harness';
    if (referer) {
      headers['HTTP-Referer'] = referer;
    }
    headers['X-Title'] = title;
  }

  const start = performance.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const durationMs = performance.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const answer = data?.choices?.[0]?.message?.content?.trim() || '';
  return { data, answer, durationMs };
};

const writeResults = (outputDir, payload) => {
  ensureDir(outputDir);
  const timestamp = new Date().toISOString().replace(/[:]/g, '-');
  const filePath = path.join(outputDir, `run-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
};

const main = async () => {
  const program = new Command();
  program
    .option('--suite <path>', 'Path to the eval suite JSON', DEFAULT_SUITE_PATH)
    .option('--kb-data <path>', 'Path to the kb-data.json file', DEFAULT_KB_DATA_PATH)
    .option('--kb-url <url>', 'Knowledge-base service URL to fetch documents from', DEFAULT_KB_URL)
    .option('--schema <path>', 'Path to the UI schema JSON for KB /query requests', DEFAULT_SCHEMA_PATH)
    .option('--output <dir>', 'Directory for result artifacts', DEFAULT_OUTPUT_DIR)
    .option('--model <name>', 'Model identifier to request', process.env.EVAL_LLM_MODEL || process.env.LLM_MODEL || 'gpt-4.1-mini')
    .option('--endpoint <url>', 'Chat completions endpoint URL', process.env.EVAL_LLM_ENDPOINT || process.env.LLM_ENDPOINT || 'http://localhost:1234/v1/chat/completions')
    .option('--api-key <key>', 'API key for Authorization header', process.env.EVAL_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY)
    .option('--provider <name>', 'Provider hint for logging', process.env.EVAL_PROVIDER || (process.env.OPENROUTER_API_KEY ? 'openrouter' : 'local'))
    .option('--mode <mode>', 'Evaluation mode: chat (default) or kb', process.env.EVAL_MODE || 'chat')
    .option('--dry-run', 'Skip remote calls and just print prompts')
    .parse(process.argv);

  const options = program.opts();
  const mode = (options.mode || 'chat').toLowerCase();
  if (!EVAL_MODES.has(mode)) {
    console.error(chalk.red(`Unknown mode '${options.mode}'. Supported modes: chat, kb.`));
    process.exit(1);
  }

  const suitePath = path.resolve(options.suite);
  const kbDataPath = path.resolve(options.kbData || DEFAULT_KB_DATA_PATH);
  const schemaPath = path.resolve(options.schema || DEFAULT_SCHEMA_PATH);
  const kbUrl = options.kbUrl || DEFAULT_KB_URL || null;
  const outputDir = path.resolve(options.output);

  let suite;
  try {
    suite = readJsonFile(suitePath);
  } catch (error) {
    console.error(chalk.red(`Failed to load eval suite: ${error.message}`));
    process.exit(1);
  }

  const documentsById = await loadKnowledgeDocuments({ kbDataPath, kbUrl });
  const scenarios = Array.isArray(suite.scenarios) ? suite.scenarios : [];
  if (!scenarios.length) {
    console.error(chalk.red('Eval suite does not contain any scenarios.'));
    process.exit(1);
  }

  console.log(chalk.cyan(`Loaded ${scenarios.length} scenarios from ${suitePath}`));

  let uiSchema = null;
  let kbLlmConfig = null;
  if (mode === 'kb') {
    uiSchema = tryReadJsonFile(schemaPath);
    if (!uiSchema) {
      console.error(chalk.red('KB mode requires a valid schema JSON file.'));
      process.exit(1);
    }
    if (!kbUrl) {
      console.error(chalk.red('KB mode requires --kb-url or EVAL_KB_URL.'));
      process.exit(1);
    }

    kbLlmConfig = await fetchKbLlmConfig(kbUrl);
  }

  const runResults = [];

  for (const scenario of scenarios) {
    console.log(`\n${chalk.bold(`[${scenario.id}] ${scenario.name}`)}`);
    const prompt = buildPrompt(scenario, documentsById);

    if (options.dryRun) {
      console.log(chalk.gray(`Dry run (${mode}) prompt preview:\n`));
      console.log(prompt);
      runResults.push({
        scenarioId: scenario.id,
        name: scenario.name,
        prompt,
        mode,
        skipped: true,
      });
      continue;
    }

    try {
      let answer;
      let data;
      let durationMs = 0;
      let extraPayload = {};
      let llmMeta = null;

      if (mode === 'kb') {
        const kbPayload = buildKnowledgeBasePayload(scenario, { uiSchema });
        extraPayload = { kbPayload };
        const result = await callKnowledgeBase({ kbUrl, payload: kbPayload });
        ({ data, answer, durationMs, llmMeta } = result);
      } else {
        const result = await callChatCompletion({
          endpoint: options.endpoint,
          model: options.model,
          apiKey: options.apiKey,
          provider: options.provider,
          prompt,
        });
        ({ data, answer, durationMs } = result);
      }

      const flaggedSignals = detectFailureSignals(answer, scenario.failureSignals);
      const statusLabel = flaggedSignals.length ? chalk.yellow('WARN') : chalk.green('OK');
      console.log(`${statusLabel} ${chalk.dim(`(${durationMs.toFixed(0)} ms)`)}`);
      if (flaggedSignals.length) {
        console.log(chalk.yellow(`  Potential failure signals detected: ${flaggedSignals.join(', ')}`));
      }

      runResults.push({
        scenarioId: scenario.id,
        name: scenario.name,
        mode,
        prompt,
        answer,
        durationMs,
        flaggedSignals,
        rawResponse: data,
        llmMeta,
        ...extraPayload,
      });
    } catch (error) {
      console.error(chalk.red(`  Error: ${error.message}`));
      runResults.push({
        scenarioId: scenario.id,
        name: scenario.name,
        mode,
        prompt,
        error: error.message,
      });
    }
  }

  let successCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  let durationSum = 0;
  let durationSamples = 0;
  let llmCallCount = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalReasoningTokens = 0;
  let totalTokens = 0;
  let totalLlmDurationMs = 0;
  const providerHistogram = {};
  const modelHistogram = {};

  const readTokenValue = (usage, ...keys) => {
    if (!usage || typeof usage !== 'object') {
      return 0;
    }
    for (const key of keys) {
      const value = usage[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return 0;
  };

  const readReasoningTokens = (usage) => {
    if (!usage || typeof usage !== 'object') {
      return 0;
    }
    const rootValue = readTokenValue(usage, 'reasoning_tokens', 'reasoningTokens');
    if (rootValue) {
      return rootValue;
    }
    const completionDetails = usage.completion_tokens_details || usage.completionTokensDetails;
    return readTokenValue(completionDetails, 'reasoning_tokens', 'reasoningTokens');
  };

  runResults.forEach((result) => {
    if (result.error) {
      errorCount += 1;
      return;
    }
    if (result.flaggedSignals && result.flaggedSignals.length) {
      warningCount += 1;
    } else {
      successCount += 1;
    }
    if (typeof result.durationMs === 'number' && Number.isFinite(result.durationMs)) {
      durationSum += result.durationMs;
      durationSamples += 1;
    }

    if (result.llmMeta) {
      llmCallCount += 1;
      if (result.llmMeta.provider) {
        const key = result.llmMeta.provider;
        providerHistogram[key] = (providerHistogram[key] || 0) + 1;
      }
      if (result.llmMeta.model) {
        const modelKey = result.llmMeta.model;
        modelHistogram[modelKey] = (modelHistogram[modelKey] || 0) + 1;
      }
      const usage = result.llmMeta.usage || {};
      totalPromptTokens += readTokenValue(usage, 'prompt_tokens', 'promptTokens');
      totalCompletionTokens += readTokenValue(usage, 'completion_tokens', 'completionTokens');
      totalReasoningTokens += readReasoningTokens(usage);
      totalTokens += readTokenValue(usage, 'total_tokens', 'totalTokens');
      if (typeof result.llmMeta.durationMs === 'number' && Number.isFinite(result.llmMeta.durationMs)) {
        totalLlmDurationMs += result.llmMeta.durationMs;
      }
    }
  });

  const avgDuration = durationSamples ? durationSum / durationSamples : 0;
  const summary = {
    mode,
    total: runResults.length,
    successes: successCount,
    warnings: warningCount,
    errors: errorCount,
    avgDurationMs: Number(avgDuration.toFixed(1)),
  };

  if (llmCallCount > 0 || totalTokens > 0) {
    const avgLlmDuration = llmCallCount ? totalLlmDurationMs / llmCallCount : 0;
    const avgTokensPerCall = llmCallCount ? totalTokens / llmCallCount : 0;
    summary.llmStats = {
      calls: llmCallCount,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalReasoningTokens,
      avgTokensPerCall: Number(avgTokensPerCall.toFixed(1)),
      totalLlmDurationMs: Number(totalLlmDurationMs.toFixed(1)),
      avgLlmDurationMs: Number(avgLlmDuration.toFixed(1)),
      providers: providerHistogram,
      models: modelHistogram,
    };
  }

  console.log('\nSummary:');
  console.log(`  Successes: ${successCount}`);
  console.log(`  Warnings: ${warningCount}`);
  console.log(`  Errors: ${errorCount}`);
  if (durationSamples) {
    console.log(`  Avg latency: ${summary.avgDurationMs} ms over ${durationSamples} calls`);
  }
  if (summary.llmStats) {
    console.log(
      `  Tokens: ${summary.llmStats.totalTokens} total (prompt ${summary.llmStats.totalPromptTokens} / completion ${summary.llmStats.totalCompletionTokens} / reasoning ${summary.llmStats.totalReasoningTokens})`
    );
  }

  const resultPayload = {
    generatedAt: new Date().toISOString(),
    suite: suite.suite || 'kb-alignment',
    version: suite.version || 'unversioned',
    config: {
      model: kbLlmConfig?.model || options.model,
      endpoint: kbLlmConfig?.endpoint || options.endpoint,
      provider: kbLlmConfig?.provider || options.provider,
      suitePath,
      kbDataPath,
      kbUrl,
      schemaPath,
      dryRun: Boolean(options.dryRun),
      mode,
      resolvedLlmConfig: kbLlmConfig,
    },
    results: runResults,
    summary,
  };

  const artifactPath = writeResults(outputDir, resultPayload);
  console.log(`\n${chalk.cyan('Results written to')} ${artifactPath}`);
};

await main();
