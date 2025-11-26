import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = Number.parseInt(process.env.DEVICE_API_PORT || '3002', 10);
const listenAddress = process.env.BIND_ADDRESS || '0.0.0.0';
const serviceRegistryUrl = process.env.SERVICE_REGISTRY_URL || 'http://localhost:3000';
const coreSystemUrl = process.env.CORE_SYSTEM_URL || 'http://localhost:3001';
const devicePublicUrl = process.env.DEVICE_API_PUBLIC_URL || `http://localhost:${port}`;
const defaultThingBaseUrl = process.env.THING_BASE_URL || 'http://localhost:3006/light-switch';

app.use(express.json());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

const deviceId = 'device-smartphone-001';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, '..', 'schema.json');
const uiSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

const isAbsoluteUrl = (value) => typeof value === 'string' && /^(?:[a-z]+:)?\/\//i.test(value);

const composeUrl = (base, providedPath = '/') => {
  if (!base) return null;
  if (!providedPath || providedPath === '/' || providedPath.length === 0) {
    return base;
  }

  if (base.endsWith('/') && providedPath.startsWith('/')) {
    return `${base}${providedPath.slice(1)}`;
  }

  if (!base.endsWith('/') && !providedPath.startsWith('/')) {
    return `${base}/${providedPath}`;
  }

  return `${base}${providedPath}`;
};

const inferMethodFromOp = (opValue) => {
  const ops = Array.isArray(opValue) ? opValue : opValue ? [opValue] : [];
  for (const op of ops) {
    const normalized = typeof op === 'string' ? op.toLowerCase() : '';
    if (normalized.includes('readproperty') || normalized.includes('readallproperties')) {
      return 'GET';
    }
    if (normalized.includes('writeproperty')) {
      return 'PUT';
    }
    if (normalized.includes('invokeaction')) {
      return 'POST';
    }
  }
  return null;
};

const selectPreferredForm = (action = {}) => {
  const forms = Array.isArray(action.forms) ? action.forms : null;
  if (!forms || forms.length === 0) {
    return null;
  }

  if (typeof action.preferredFormIndex === 'number') {
    return forms[action.preferredFormIndex] || forms[0];
  }

  if (action.op) {
    const targetOps = Array.isArray(action.op) ? action.op : [action.op];
    const matched = forms.find((form) => {
      const formOps = Array.isArray(form.op)
        ? form.op
        : form.op
          ? [form.op]
          : [];
      return formOps.some((formOp) => targetOps.includes(formOp));
    });
    if (matched) {
      return matched;
    }
  }

  return forms[0];
};

const resolveCandidateBaseUrl = (action = {}, context = {}) => {
  const inferred =
    action.baseUrl
    || action.base
    || context?.thingBase
    || context?.thing?.description?.base;

  if (inferred) {
    return inferred;
  }

  if (defaultThingBaseUrl) {
    const actionIdentifier = action.href || action.path || action.service || 'unknown-action';
    console.debug(`[Device] Using fallback thing base URL '${defaultThingBaseUrl}' for ${actionIdentifier}.`);
    return defaultThingBaseUrl;
  }

  return null;
};

const enrichActionForHttp = (action = {}, context = {}) => {
  if (!action || typeof action !== 'object') {
    return action;
  }

  const expanded = { ...action };
  const selectedForm = selectPreferredForm(action);

  if (selectedForm) {
    if (!expanded.href && (selectedForm.href || selectedForm.url)) {
      expanded.href = selectedForm.href || selectedForm.url;
    }
    if (!expanded.method && selectedForm.method) {
      expanded.method = selectedForm.method;
    }
    if (!expanded.op && selectedForm.op) {
      expanded.op = selectedForm.op;
    }
    if (!expanded.baseUrl && (selectedForm.base || action.base)) {
      expanded.baseUrl = selectedForm.base || action.base;
    }
    if (selectedForm.contentType) {
      expanded.headers = { ...(expanded.headers || {}) };
      expanded.headers['Content-Type'] = expanded.headers['Content-Type'] || selectedForm.contentType;
    }
    if (expanded.body === undefined && (selectedForm.payload || selectedForm.body)) {
      expanded.body = selectedForm.payload || selectedForm.body;
    }
  }

  if (expanded.href && !expanded.path) {
    expanded.path = expanded.href;
  }

  if (!expanded.baseUrl) {
    const inferredBase = resolveCandidateBaseUrl(expanded, context);
    if (inferredBase) {
      expanded.baseUrl = inferredBase;
    }
  }

  return expanded;
};

const nowIsoString = () => new Date().toISOString();

const registerWithServiceRegistry = async () => {
  try {
    await fetch(`${serviceRegistryUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'smartphone-device',
        url: devicePublicUrl,
        type: 'device',
        metadata: {
          deviceId,
          deviceType: 'smartphone',
        },
      })
    });
    console.log('Registered device service with registry');
  } catch (error) {
    console.error('Error registering device with service registry:', error);
  }
};

const registerWithCoreSystem = async () => {
  const supportedComponents = Object.keys(uiSchema.components || {});
  const supportsTheming = uiSchema.theming?.supportsPrimaryColor ? ['theme.primaryColor'] : [];

  const deviceRegistrationPayload = {
    id: deviceId,
    name: 'Smartphone Controller',
    url: devicePublicUrl,
    thingId: 'thing-light-switch-001',
    capabilities: [],
    metadata: {
      deviceType: 'smartphone',
      supportedUiComponents: supportedComponents,
      supportsAudio: false,
      supportsTouch: true,
      supportsTheming: supportsTheming,
      uiSchema,
    },
    uiSchema,
  };

  try {
    await fetch(`${coreSystemUrl}/register/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deviceRegistrationPayload),
    });
    console.log('Registered smartphone with core system');
  } catch (error) {
    console.error('Error registering device with core system:', error);
  }
};

const invokeDeviceTool = async (toolName) => {
  throw new Error(`Tool '${toolName || 'unknown'}' is not supported on this device.`);
};

const resolveActionUrl = async (action = {}, context = {}) => {
  if (!action) {
    return null;
  }

  if (action.url) {
    return action.url;
  }

  if (action.href) {
    if (isAbsoluteUrl(action.href)) {
      return action.href;
    }

    const baseFromContext = resolveCandidateBaseUrl(action, context);
    if (baseFromContext) {
      const resolved = composeUrl(baseFromContext, action.href);
      if (resolved) {
        return resolved;
      }
    }
  }

  if (action.path) {
    const baseFromContext = resolveCandidateBaseUrl(action, context);
    if (baseFromContext) {
      const resolved = composeUrl(baseFromContext, action.path);
      if (resolved) {
        return resolved;
      }
    }
  }

  if (action.service) {
    const serviceResponse = await fetch(`${serviceRegistryUrl}/services/${action.service}`);
    if (!serviceResponse.ok) {
      throw new Error(`Failed to resolve service '${action.service}'.`);
    }

    const record = await serviceResponse.json();
    const targetPath = action.path || action.endpoint || '/';
    return composeUrl(record.url, targetPath);
  }

  if (action.baseUrl && action.path) {
    return composeUrl(action.baseUrl, action.path);
  }

  return null;
};

const dispatchHttpAction = async (action, context = {}) => {
  const enrichedAction = enrichActionForHttp(action, context);
  const targetUrl = await resolveActionUrl(enrichedAction, context);
  if (!targetUrl) {
    throw new Error('No target URL supplied for HTTP action.');
  }

  const inferredMethod = inferMethodFromOp(enrichedAction?.op);
  const method = (enrichedAction?.method || inferredMethod || 'POST').toUpperCase();
  const headers = { ...(enrichedAction?.headers || {}) };
  let body = enrichedAction?.body || enrichedAction?.payload || enrichedAction?.data || null;

  if (body && typeof body === 'object' && !(body instanceof Buffer)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = JSON.stringify(body);
  } else if (!body && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = JSON.stringify({ context, timestamp: nowIsoString() });
  }

  console.log(`[Device] Dispatching HTTP action ${method} ${targetUrl}`);
  const response = await fetch(targetUrl, { method, headers, body });
  const rawText = await response.text();
  let parsedBody = rawText;

  try {
    parsedBody = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    parsedBody = rawText;
  }

  if (!response.ok) {
    throw new Error(`Remote action responded with status ${response.status}`);
  }

  return {
    url: targetUrl,
    status: response.status,
    body: parsedBody,
  };
};

const performExecutableAction = async (action, context = {}) => {
  if (!action) {
    throw new Error('Missing action payload.');
  }

  if (typeof action === 'string') {
    console.log(`[Device] Executing simple command: ${action}`);
    return {
      kind: 'command',
      command: action,
      acknowledgedAt: nowIsoString(),
    };
  }

  const normalizedType = typeof action.type === 'string' ? action.type.toLowerCase() : null;
  const toolName = action.tool || action.toolName || action.command;

  if (normalizedType === 'tool' || normalizedType === 'tool-call' || toolName) {
    const result = await invokeDeviceTool(toolName, action.parameters || action.args || action.payload || {});
    return { kind: 'tool', tool: toolName, result };
  }

  if (
    normalizedType === 'http'
    || action.url
    || action.service
    || action.baseUrl
    || action.href
    || (Array.isArray(action.forms) && action.forms.length > 0)
  ) {
    const result = await dispatchHttpAction(action, context);
    return { kind: 'http', response: result };
  }

  return { kind: 'noop', note: 'No executable properties found on action payload.' };
};

const describeActionResult = (result) => {
  if (!result) {
    return 'Action acknowledged.';
  }

  switch (result.kind) {
    case 'tool':
      return `Tool '${result.tool}' invoked successfully.`;
    case 'http':
      return `Forwarded request to remote endpoint (${result.response.status}).`;
    case 'command':
      return `Command '${result.command}' acknowledged.`;
    case 'noop':
    default:
      return result.note || 'Action acknowledged.';
  }
};

app.post('/api/call-tool', async (req, res) => {
  try {
    const result = await invokeDeviceTool(req.body?.toolName, req.body?.parameters || req.body?.args || {});
    res.json(result);
  } catch (error) {
    console.error('Tool invocation failed:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/execute-action', async (req, res) => {
  const { action, context } = req.body || {};

  if (!action) {
    return res.status(400).json({ error: 'Action payload is required.' });
  }

  try {
    const result = await performExecutableAction(action, context || {});
    res.json({ status: 'executed', message: describeActionResult(result), result });
  } catch (error) {
    console.error('Failed to execute action:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, listenAddress, () => {
  console.log(`Smartphone device service listening at ${listenAddress}:${port} (public URL: ${devicePublicUrl})`);
  registerWithServiceRegistry();
  registerWithCoreSystem();
});
