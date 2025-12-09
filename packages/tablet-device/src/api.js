import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = Number.parseInt(process.env.DEVICE_API_PORT || '3012', 10);
const listenAddress = process.env.BIND_ADDRESS || '0.0.0.0';
const serviceRegistryUrl = process.env.SERVICE_REGISTRY_URL || 'http://core-system:3000';
const coreSystemUrl = process.env.CORE_SYSTEM_URL || 'http://core-system:3001';
const devicePublicUrl = process.env.DEVICE_API_PUBLIC_URL || `http://tablet-device-api:${port}`;
const defaultThingBaseUrl = process.env.THING_BASE_URL || null;
const ACTION_CACHE_TTL_MS = Number.parseInt(process.env.ACTION_CACHE_TTL_MS || '60000', 10);

app.use(express.json());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5174')
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

const deviceId = 'device-tablet-001';
const actionCacheByThing = new Map();
const actionCacheById = new Map();
const arrayify = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [value];
};

const canonicalizeIntentName = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.toString().trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized;
};

const getActionIntentAliases = (action) => (
  arrayify(action?.metadata?.intentAliases)
    .map((alias) => canonicalizeIntentName(alias))
    .filter(Boolean)
);

const actionHasIntentAlias = (action, canonicalIntentName) => (
  getActionIntentAliases(action).includes(canonicalIntentName)
);

const collectActionNameCandidates = (action = {}) => {
  const candidates = [action.id, action.name, action.title, action.actionId, action.actionName];
  return candidates
    .map((value) => canonicalizeIntentName(value))
    .filter(Boolean);
};

const actionMatchesIntent = (action, canonicalIntentName) => {
  if (!action || !canonicalIntentName) {
    return false;
  }

  if (actionHasIntentAlias(action, canonicalIntentName)) {
    return true;
  }

  const normalizedCandidates = collectActionNameCandidates(action);
  return normalizedCandidates.includes(canonicalIntentName);
};



const determineCandidateThingIds = (context = {}) => {
  const ids = new Set();
  const possible = [
    context.thingId,
    context.thing?.id,
    context.thing?.thingId,
    context.targetThingId,
    context.defaultThingId,
  ];

  possible.forEach((id) => {
    if (typeof id === 'string' && id.trim()) {
      ids.add(id.trim());
    }
  });

  actionCacheByThing.forEach((_value, key) => {
    if (key) {
      ids.add(key);
    }
  });

  return Array.from(ids);
};

const loadThingActionsForIntent = async (context = {}) => {
  const thingIds = determineCandidateThingIds(context);
  const entries = await Promise.all(
    thingIds.map(async (thingId) => ({
      thingId,
      actions: await getThingActions(thingId),
    }))
  );

  return entries.filter((entry) => Array.isArray(entry.actions) && entry.actions.length > 0);
};

const resolveIntentActions = async (intentName, context = {}) => {
  const canonicalIntent = canonicalizeIntentName(intentName);
  if (!canonicalIntent) {
    return { intent: null, matches: [] };
  }

  const thingEntries = await loadThingActionsForIntent(context);
  const matches = [];

  thingEntries.forEach(({ thingId, actions }) => {
    actions.forEach((action) => {
      if (actionMatchesIntent(action, canonicalIntent)) {
        matches.push({ thingId, action });
      }
    });
  });

  return { intent: canonicalIntent, matches };
};

const normalizeActionKey = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const collectCandidateActionKeys = (actionPayload = {}) => {
  const rawCandidates = [
    actionPayload.id,
    actionPayload.actionId,
    actionPayload.name,
    actionPayload.actionName,
    actionPayload.command,
    actionPayload.intent,
    actionPayload.action,
    actionPayload.title,
  ];

  const deduped = [];
  rawCandidates.forEach((candidate) => {
    const normalized = normalizeActionKey(candidate);
    if (!normalized) {
      return;
    }
    if (!deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  });

  return deduped;
};

const matchDescriptorByCandidates = (actions = [], candidates = []) => {
  if (!Array.isArray(actions) || actions.length === 0 || candidates.length === 0) {
    return null;
  }

  const loweredCandidates = candidates.map((candidate) => candidate.toLowerCase());

  return actions.find((descriptor) => {
    const comparisonFields = [descriptor.id, descriptor.name, descriptor.title]
      .filter((field) => typeof field === 'string')
      .map((field) => field.toLowerCase());
    return loweredCandidates.some((candidate) => comparisonFields.includes(candidate));
  }) || null;
};

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

const hasExecutableHints = (candidate) => {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  if (candidate.url || candidate.href || candidate.path || candidate.service) {
    return true;
  }
  if ((candidate.baseUrl && candidate.method) || candidate.transport) {
    return true;
  }
  if (Array.isArray(candidate.forms) && candidate.forms.length > 0) {
    return true;
  }
  return false;
};

const deriveThingIdFromActionId = (actionId = '') => {
  if (typeof actionId !== 'string') {
    return null;
  }
  const delimiterIndex = actionId.indexOf('::');
  if (delimiterIndex === -1) {
    return null;
  }
  return actionId.slice(0, delimiterIndex) || null;
};

const rememberThingActions = (thingId, actions = []) => {
  if (!thingId) {
    return [];
  }
  const normalized = Array.isArray(actions) ? actions : [];
  actionCacheByThing.set(thingId, { actions: normalized, fetchedAt: Date.now() });
  normalized.forEach((descriptor) => {
    if (descriptor?.id) {
      actionCacheById.set(descriptor.id, descriptor);
    }
  });
  return normalized;
};

const getCachedThingActions = (thingId) => {
  if (!thingId) {
    return null;
  }
  const cached = actionCacheByThing.get(thingId);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.fetchedAt > ACTION_CACHE_TTL_MS) {
    actionCacheByThing.delete(thingId);
    return null;
  }
  return cached.actions;
};

const fetchThingActionsFromCore = async (thingId) => {
  if (!thingId) {
    return [];
  }

  try {
    const response = await fetch(`${coreSystemUrl}/things/${encodeURIComponent(thingId)}/actions`);
    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(`[Tablet Device] Failed to fetch actions for thing '${thingId}': ${response.status}`);
      }
      return [];
    }

    const payload = await response.json();
    const actions = Array.isArray(payload?.actions) ? payload.actions : [];
    return rememberThingActions(thingId, actions);
  } catch (error) {
    console.error(`[Tablet Device] Error fetching actions for thing '${thingId}':`, error.message);
    return [];
  }
};

const getThingActions = async (thingId) => {
  const cached = getCachedThingActions(thingId);
  if (cached) {
    return cached;
  }
  return fetchThingActionsFromCore(thingId);
};

const fetchActionByIdFromCore = async (actionId) => {
  if (!actionId) {
    return null;
  }

  try {
    const response = await fetch(`${coreSystemUrl}/actions/${encodeURIComponent(actionId)}`);
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const descriptor = payload?.action || null;
    if (descriptor?.thingId) {
      const existing = getCachedThingActions(descriptor.thingId) || [];
      const nextEntries = existing.some((entry) => entry.id === descriptor.id)
        ? existing.map((entry) => (entry.id === descriptor.id ? descriptor : entry))
        : [...existing, descriptor];
      rememberThingActions(descriptor.thingId, nextEntries);
    } else if (descriptor?.id) {
      actionCacheById.set(descriptor.id, descriptor);
    }
    return descriptor;
  } catch (error) {
    console.error(`[Tablet Device] Error fetching action '${actionId}' from core:`, error.message);
    return null;
  }
};

const mergeActionDescriptors = (baseDescriptor = {}, overrideDescriptor = {}) => {
  const merged = {
    ...baseDescriptor,
    ...overrideDescriptor,
  };

  merged.transport = {
    ...(baseDescriptor.transport || {}),
    ...(overrideDescriptor.transport || {}),
  };

  merged.headers = {
    ...(baseDescriptor.headers || {}),
    ...(overrideDescriptor.headers || {}),
  };

  const overrideForms = Array.isArray(overrideDescriptor.forms) && overrideDescriptor.forms.length > 0
    ? overrideDescriptor.forms
    : null;
  merged.forms = overrideForms || baseDescriptor.forms || [];

  if (!merged.url && merged.transport?.url) {
    merged.url = merged.transport.url;
  }
  if (!merged.href && merged.transport?.href) {
    merged.href = merged.transport.href;
  }
  if (!merged.path && merged.transport?.path) {
    merged.path = merged.transport.path;
  }
  if (!merged.method && merged.transport?.method) {
    merged.method = merged.transport.method;
  }
  if (!merged.baseUrl && merged.transport?.baseUrl) {
    merged.baseUrl = merged.transport.baseUrl;
  }

  return merged;
};

const resolveActionDescriptor = async (actionPayload, context = {}) => {
  if (!actionPayload || typeof actionPayload !== 'object') {
    return actionPayload;
  }

  if (hasExecutableHints(actionPayload)) {
    return actionPayload;
  }

  const candidateKeys = collectCandidateActionKeys(actionPayload);
  const derivedThingId = candidateKeys
    .map((candidate) => deriveThingIdFromActionId(candidate))
    .find(Boolean)
    || null;
  const resolvedThingId = actionPayload.thingId
    || context.thingId
    || context.thing?.id
    || context.thing?.thingId
    || context.defaultThingId
    || derivedThingId
    || null;

  let descriptor = null;

  for (const candidate of candidateKeys) {
    if (!candidate) {
      continue;
    }
    const cachedDescriptor = actionCacheById.get(candidate);
    if (cachedDescriptor) {
      descriptor = cachedDescriptor;
      break;
    }
  }

  if (!descriptor && resolvedThingId) {
    const actions = await getThingActions(resolvedThingId);
    descriptor = matchDescriptorByCandidates(actions, candidateKeys);
  }

  if (!descriptor) {
    for (const candidate of candidateKeys) {
      if (!candidate || !candidate.includes('::')) {
        continue;
      }
      const fetched = await fetchActionByIdFromCore(candidate);
      if (fetched) {
        descriptor = fetched;
        break;
      }
    }
  }

  if (!descriptor) {
    return actionPayload;
  }

  return mergeActionDescriptors(descriptor, actionPayload);
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
    || action.transport?.baseUrl
    || context?.thingBase
    || context?.thing?.description?.base;

  if (inferred) {
    return inferred;
  }

  if (defaultThingBaseUrl) {
    const actionIdentifier = action.href || action.path || action.service || 'unknown-action';
    console.debug(`[Tablet Device] Using fallback thing base URL '${defaultThingBaseUrl}' for ${actionIdentifier}.`);
    return defaultThingBaseUrl;
  }

  return null;
};

const enrichActionForHttp = (action = {}, context = {}) => {
  if (!action || typeof action !== 'object') {
    return action;
  }

  const expanded = { ...action };
  if (action.transport && typeof action.transport === 'object') {
    const transport = action.transport;
    if (!expanded.url && transport.url) {
      expanded.url = transport.url;
    }
    if (!expanded.href && (transport.href || transport.path)) {
      expanded.href = transport.href || transport.path;
    }
    if (!expanded.method && transport.method) {
      expanded.method = transport.method;
    }
    if (!expanded.baseUrl && transport.baseUrl) {
      expanded.baseUrl = transport.baseUrl;
    }
    if (transport.headers) {
      expanded.headers = {
        ...(transport.headers || {}),
        ...(expanded.headers || {}),
      };
    }
  }
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

// Advertise this device to the simple service registry so other services can discover the HTTP entrypoint.
const registerWithServiceRegistry = async () => {
  try {
    await fetch(`${serviceRegistryUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'tablet-device',
        url: devicePublicUrl,
        type: 'device',
        metadata: {
          deviceId,
          deviceType: 'tablet',
        },
      })
    });
    console.log('Registered tablet device service with registry');
  } catch (error) {
    console.error('Error registering tablet device with service registry:', error);
  }
};

// Tell the core which UI components we can render so it can filter the schema before prompting the LLM.
const registerWithCoreSystem = async () => {
  const supportedComponents = Object.keys(uiSchema.components || {});
  const supportsTheming = uiSchema.theming?.supportsPrimaryColor ? ['theme.primaryColor'] : [];

  const deviceRegistrationPayload = {
    id: deviceId,
    name: 'Tablet Dashboard',
    url: devicePublicUrl,
    capabilities: [],
    metadata: {
      deviceType: 'tablet',
      supportedUiComponents: supportedComponents,
      supportsAudio: false,
      supportsTouch: true,
      supportsPointer: true,
      supportsKeyboard: true,
      supportsTheming: supportsTheming,
      layoutGridColumns: 12,
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
    console.log('Registered tablet device with core system');
  } catch (error) {
    console.error('Error registering tablet device with core system:', error);
  }
};

// Device-level tools are just intent aliases; resolve them to concrete actions and fan out per matching Thing.
const invokeDeviceTool = async (toolName, parameters = {}, context = {}) => {
  const { intent, matches } = await resolveIntentActions(toolName, context);

  if (!intent) {
    throw new Error(`Tool '${toolName || 'unknown'}' is not supported on this device.`);
  }

  if (matches.length === 0) {
    throw new Error(`Intent '${intent}' is not available for the current thing context.`);
  }

  const responses = [];
  for (const match of matches) {
    const targetContext = { ...context, thingId: match.thingId };
    const result = await dispatchHttpAction(match.action, targetContext);
    responses.push({
      thingId: match.thingId,
      actionId: match.action.id,
      response: result,
    });
  }

  return {
    intent,
    parameters,
    invoked: responses,
  };
};

// Try to rebuild an absolute URL for an action using whatever hints we have (forms, href, device defaults, env vars).
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

  console.log(`[Tablet Device] Dispatching HTTP action ${method} ${targetUrl}`);
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

const performExecutableAction = async (actionPayload, context = {}) => {
  if (actionPayload === undefined || actionPayload === null) {
    throw new Error('Missing action payload.');
  }

  const originalWasString = typeof actionPayload === 'string';
  const initialEnvelope = originalWasString ? { id: actionPayload } : { ...actionPayload };
  const resolvedAction = await resolveActionDescriptor(initialEnvelope, context);
  const resolvedThingId =
    context.thingId
    || resolvedAction.thingId
    || deriveThingIdFromActionId(resolvedAction.id)
    || context.defaultThingId
    || null;

  const resolvedContext = {
    ...context,
    thingId: resolvedThingId,
  };

  if (originalWasString && !hasExecutableHints(resolvedAction)) {
    console.log(`[Tablet Device] Executing simple command: ${actionPayload}`);
    return {
      kind: 'command',
      command: actionPayload,
      acknowledgedAt: nowIsoString(),
    };
  }

  const normalizedType = typeof resolvedAction.type === 'string' ? resolvedAction.type.toLowerCase() : null;
  const toolName = resolvedAction.tool
    || resolvedAction.toolName
    || resolvedAction.command
    || resolvedAction.intent
    || resolvedAction.intentName;

  const isToolInvocation = (
    normalizedType === 'tool'
    || normalizedType === 'tool-call'
    || normalizedType === 'toolcall'
    || normalizedType === 'intent'
    || Boolean(toolName)
  );

  if (isToolInvocation) {
    const result = await invokeDeviceTool(
      toolName,
      resolvedAction.parameters || resolvedAction.args || resolvedAction.payload || {},
      resolvedContext,
    );
    return { kind: 'tool', tool: toolName, result };
  }

  const hasHttpDescriptor =
    normalizedType === 'http'
    || hasExecutableHints(resolvedAction);

  if (hasHttpDescriptor) {
    const result = await dispatchHttpAction(resolvedAction, resolvedContext);
    return { kind: 'http', response: result };
  }

  console.warn('[Tablet Device] No executable properties found on action payload:', {
    action: resolvedAction,
    originalPayload: actionPayload,
    context: resolvedContext,
  });
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
    const result = await invokeDeviceTool(
      req.body?.toolName,
      req.body?.parameters || req.body?.args || {},
      req.body?.context || {},
    );
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
  console.log(`Tablet device service listening at ${listenAddress}:${port} (public URL: ${devicePublicUrl})`);
  registerWithServiceRegistry();
  registerWithCoreSystem();
});
