const arrayify = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [value];
};

const intentSynonyms = {
  quickalloff: 'lights.off.all',
  'lights.off': 'lights.off.all',
  'lights.off.all': 'lights.off.all',
  'lights.turnoff': 'lights.off.all',
  'lights.turnoff.all': 'lights.off.all',
  alllightsoff: 'lights.off.all',
  alloff: 'lights.off.all',
  'all.lights.off': 'lights.off.all',
  poweroff: 'lights.off.all',
  'lights.on': 'lights.on.device',
  'lights.turnon': 'lights.on.device',
  'lights.on.device': 'lights.on.device',
  poweron: 'lights.on.device',
  'lights.toggle': 'lights.toggle.device',
  'switch.toggle': 'lights.toggle.device',
  toggle: 'lights.toggle.device',
};

const canonicalizeIntentName = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.toString().trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return intentSynonyms[normalized] || normalized;
};

const getActionIntentAliases = (action) => (
  arrayify(action?.metadata?.intentAliases)
    .map((alias) => canonicalizeIntentName(alias) || alias?.toString().trim().toLowerCase())
    .filter(Boolean)
);

const isLightingAction = (action) => {
  const capability = action?.metadata?.capability || action?.capability || '';
  return typeof capability === 'string' && capability.toLowerCase().includes('lighting');
};

const actionMatchesIntent = (action, canonicalIntentName) => {
  if (!action || !canonicalIntentName) {
    return false;
  }

  const aliases = getActionIntentAliases(action);
  if (aliases.includes(canonicalIntentName)) {
    return true;
  }

  const title = (action.title || action.name || '').toLowerCase();
  const description = (action.description || '').toLowerCase();

  switch (canonicalIntentName) {
    case 'lights.off.all':
      return isLightingAction(action) && (/off/.test(title) || /off/.test(description));
    case 'lights.on.device':
      return isLightingAction(action) && (/on/.test(title) || /on/.test(description));
    case 'lights.toggle.device':
      return isLightingAction(action) && (/toggle/.test(title) || /toggle/.test(description));
    default:
      return false;
  }
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
    actionPayload.type,
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
  const baseForms = Array.isArray(baseDescriptor.forms)
    ? baseDescriptor.forms.map((form) => ({ ...form }))
    : [];
  merged.forms = overrideForms || baseForms;

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

const truthyStrings = new Set(['true', 'on', '1', 'enable', 'enabled', 'yes']);
const falsyStrings = new Set(['false', 'off', '0', 'disable', 'disabled', 'no']);
const genericLightingCommands = new Set(['setpower', 'setpowerstate', 'setstate', 'power']);
const genericBrightnessCommands = new Set(['setbrightness', 'setlevel', 'brightness']);
const genericAllOffCommands = new Set(['alloff', 'turnoffall', 'turnoffeverything', 'shutdownall', 'lightsout']);

const coerceBooleanLike = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return null;
    }
    if (value > 0) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (truthyStrings.has(normalized)) {
      return true;
    }
    if (falsyStrings.has(normalized)) {
      return false;
    }
  }
  return null;
};

const deriveGenericLightingIntent = (actionPayload = {}, componentContext = {}) => {
  const primaryName = actionPayload.action
    || actionPayload.command
    || actionPayload.intent
    || actionPayload.type;
  const actionName = typeof primaryName === 'string' ? primaryName.trim().toLowerCase() : '';
  const contextLabel = typeof componentContext.label === 'string' ? componentContext.label.toLowerCase() : '';
  const componentType = (componentContext.component || '').toString().toLowerCase();
  const boolLike = coerceBooleanLike(
    actionPayload.value
      ?? actionPayload.state
      ?? actionPayload.targetState
      ?? componentContext.value
  );

  if (genericAllOffCommands.has(actionName) || contextLabel.includes('turn off all') || actionPayload.scope === 'home') {
    return 'lights.off.all';
  }

  if (genericLightingCommands.has(actionName)) {
    if (boolLike === true || contextLabel.includes('turn on')) {
      return 'lights.on.device';
    }
    if (boolLike === false || contextLabel.includes('turn off')) {
      return 'lights.off.all';
    }
    if (componentType === 'toggle') {
      return 'lights.toggle.device';
    }
    return null;
  }

  if (genericBrightnessCommands.has(actionName) || contextLabel.includes('brightness')) {
    if (boolLike === false) {
      return 'lights.off.all';
    }
    if (boolLike === true) {
      return 'lights.on.device';
    }
    return 'lights.toggle.device';
  }

  if (actionName === 'toggle' || contextLabel.includes('toggle') || componentType === 'toggle') {
    return 'lights.toggle.device';
  }

  if (contextLabel.includes('turn on')) {
    return 'lights.on.device';
  }
  if (contextLabel.includes('turn off')) {
    return 'lights.off.all';
  }

  return null;
};

const FALLBACK_THING_ID = '__fallback__';

const buildAugmentationContext = (thingActions = [], defaultThingId = null) => {
  const actionsByThingId = new Map();
  const actionById = new Map();
  const allActions = [];

  thingActions.forEach((action) => {
    if (!action || typeof action !== 'object') {
      return;
    }
    const resolvedThingId = action.thingId || defaultThingId || FALLBACK_THING_ID;
    if (!actionsByThingId.has(resolvedThingId)) {
      actionsByThingId.set(resolvedThingId, []);
    }
    actionsByThingId.get(resolvedThingId).push(action);
    if (action.id) {
      actionById.set(action.id, action);
    }
    allActions.push(action);
  });

  return {
    defaultThingId,
    actionsByThingId,
    actionById,
    allActions,
  };
};

const findDescriptorByCandidates = (candidateKeys, resolvedThingId, context) => {
  if (resolvedThingId && context.actionsByThingId.has(resolvedThingId)) {
    const targeted = matchDescriptorByCandidates(context.actionsByThingId.get(resolvedThingId), candidateKeys);
    if (targeted) {
      return targeted;
    }
  }

  for (const candidate of candidateKeys) {
    const descriptor = context.actionById.get(candidate);
    if (descriptor) {
      return descriptor;
    }
  }

  for (const descriptors of context.actionsByThingId.values()) {
    const fallbackMatch = matchDescriptorByCandidates(descriptors, candidateKeys);
    if (fallbackMatch) {
      return fallbackMatch;
    }
  }

  return null;
};

const findDescriptorByIntent = (actionPayload, componentContext, resolvedThingId, context) => {
  const inferredIntent = deriveGenericLightingIntent(actionPayload, componentContext);
  if (!inferredIntent) {
    return null;
  }

  const canonicalIntent = canonicalizeIntentName(inferredIntent);
  if (!canonicalIntent) {
    return null;
  }

  const candidateThingIds = [];
  if (resolvedThingId && context.actionsByThingId.has(resolvedThingId)) {
    candidateThingIds.push(resolvedThingId);
  }
  context.actionsByThingId.forEach((_value, key) => {
    if (!candidateThingIds.includes(key)) {
      candidateThingIds.push(key);
    }
  });

  for (const thingId of candidateThingIds) {
    const descriptors = context.actionsByThingId.get(thingId) || [];
    const match = descriptors.find((descriptor) => actionMatchesIntent(descriptor, canonicalIntent));
    if (match) {
      return match;
    }
  }

  return null;
};

const augmentActionPayload = (actionPayload, componentContext, context) => {
  if (!actionPayload || typeof actionPayload !== 'object') {
    return actionPayload;
  }

  if (hasExecutableHints(actionPayload)) {
    return actionPayload;
  }

  const effectiveContext = {
    ...componentContext,
  };

  if (actionPayload.label || actionPayload.title || actionPayload.text) {
    effectiveContext.label = actionPayload.label || actionPayload.title || actionPayload.text;
  }
  if (actionPayload.value !== undefined && actionPayload.value !== null) {
    effectiveContext.value = actionPayload.value;
  }

  const resolvedThingId = actionPayload.thingId || componentContext.thingId || context.defaultThingId || FALLBACK_THING_ID;
  const candidateKeys = collectCandidateActionKeys(actionPayload);

  let descriptor = findDescriptorByCandidates(candidateKeys, resolvedThingId, context);

  if (!descriptor) {
    descriptor = findDescriptorByIntent(actionPayload, effectiveContext, resolvedThingId, context);
  }

  if (!descriptor) {
    return actionPayload;
  }

  const merged = mergeActionDescriptors(descriptor, {
    ...actionPayload,
    thingId: descriptor.thingId || actionPayload.thingId || effectiveContext.thingId || context.defaultThingId,
  });

  console.log(`[Core] Replaced generic action '${actionPayload.action || actionPayload.type || 'unknown'}' with WoT descriptor '${descriptor.id}'.`);
  return merged;
};

const actionPropertyPattern = /action/i;

const enrichActionProperty = (value, componentContext, context) => {
  if (Array.isArray(value)) {
    return value.map((entry) => enrichActionProperty(entry, componentContext, context));
  }

  if (value && typeof value === 'object') {
    if (value.action && typeof value.action === 'object' && !hasExecutableHints(value)) {
      const wrapper = { ...value };
      wrapper.action = enrichActionProperty(wrapper.action, componentContext, context);
      return wrapper;
    }

    const descriptorHints = ['id', 'action', 'command', 'intent', 'type', 'forms', 'href', 'url', 'service'];
    const looksLikeDescriptor = descriptorHints.some((hint) => value[hint] !== undefined);

    if (looksLikeDescriptor || hasExecutableHints(value)) {
      return augmentActionPayload(value, componentContext, context);
    }

    const candidateKeys = Object.keys(value);
    const wrapper = { ...value };
    candidateKeys.forEach((key) => {
      if (actionPropertyPattern.test(key)) {
        wrapper[key] = enrichActionProperty(wrapper[key], componentContext, context);
      }
    });
    return wrapper;
  }

  return value;
};

const enrichComponent = (component, context) => {
  if (!component || typeof component !== 'object') {
    return component;
  }

  const componentContext = {
    component: component.type,
    label: component.label || component.title || component.text || component.name || '',
    value: component.value ?? component.checked ?? component.state,
    thingId: component.thingId || context.defaultThingId,
  };

  Object.entries(component).forEach(([key, value]) => {
    if (key === 'children' && Array.isArray(value)) {
      component.children = value.map((child) => enrichComponent(child, context));
      return;
    }

    if (actionPropertyPattern.test(key)) {
      component[key] = enrichActionProperty(value, componentContext, context);
    }
  });

  return component;
};

export const attachThingActionsToUi = (uiDefinition, { thingActions = [], defaultThingId = null } = {}) => {
  if (!uiDefinition || typeof uiDefinition !== 'object') {
    return uiDefinition;
  }

  const normalizedActions = Array.isArray(thingActions) ? thingActions.filter(Boolean) : [];
  if (normalizedActions.length === 0) {
    return uiDefinition;
  }

  const augmentationContext = buildAugmentationContext(normalizedActions, defaultThingId);

  if (Array.isArray(uiDefinition.components)) {
    uiDefinition.components = uiDefinition.components.map((component) => enrichComponent(component, augmentationContext));
  }

  return uiDefinition;
};
