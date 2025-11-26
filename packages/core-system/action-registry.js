const actionProviders = [];
const actionsByThingId = new Map();
const actionById = new Map();

const arrayify = (value) => {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const slugify = (value = '') => {
  if (typeof value !== 'string' || value.length === 0) {
    return 'action';
  }
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  ) || 'action';
};

const buildActionId = (thingId, descriptor, index = 0) => {
  const baseThingId = thingId || descriptor?.thingId || 'thing';
  const actionLabel = slugify(
    descriptor?.id
      || descriptor?.actionId
      || descriptor?.name
      || descriptor?.actionName
      || descriptor?.title
      || `action-${index}`
  );
  return `${baseThingId}::${actionLabel}`;
};

const cloneForms = (forms = []) => {
  if (!Array.isArray(forms)) {
    return [];
  }
  return forms
    .filter(Boolean)
    .map((form, index) => ({
      id: form.id || `form-${index}`,
      href: form.href,
      url: form.url,
      method: form.method,
      contentType: form.contentType,
      op: Array.isArray(form.op) ? form.op.slice() : arrayify(form.op),
      security: form.security,
      subprotocol: form.subprotocol,
      metadata: form.metadata ? { ...form.metadata } : undefined,
    }));
};

const normalizeDescriptor = (
  descriptor = {},
  context = {},
  providerName = 'anonymous-provider',
  options = {}
) => {
  const effectiveThingId = descriptor.thingId
    || context.thingId
    || context.thingDescription?.id
    || options.fallbackThingId
    || null;
  const forms = cloneForms(descriptor.forms);
  const normalizedTransport = descriptor.transport || forms[0] || null;

  const normalized = {
    id: descriptor.id || descriptor.actionId || buildActionId(effectiveThingId, descriptor, options.index),
    thingId: effectiveThingId,
    name: descriptor.name || descriptor.actionName || descriptor.id || descriptor.title,
    title: descriptor.title || descriptor.name || descriptor.actionName || descriptor.id,
    description: descriptor.description || '',
    type: descriptor.type || 'action',
    capability: descriptor.capability || descriptor.capabilityAlias || null,
    input: descriptor.input || null,
    output: descriptor.output || null,
    metadata: descriptor.metadata ? { ...descriptor.metadata } : {},
    annotations: descriptor.annotations ? { ...descriptor.annotations } : {},
    source: descriptor.source || 'plugin',
    provider: providerName,
    transport: normalizedTransport ? { ...normalizedTransport } : null,
    forms,
  };

  if (descriptor.security) {
    normalized.security = Array.isArray(descriptor.security)
      ? descriptor.security.slice()
      : descriptor.security;
  }

  if (!normalized.name) {
    normalized.name = normalized.id;
  }

  if (!normalized.title) {
    normalized.title = normalized.name;
  }

  if (!normalized.transport && normalized.forms.length > 0) {
    normalized.transport = { ...normalized.forms[0] };
  }

  return normalized;
};

const saveActionsForThing = (thingId, actions = []) => {
  if (!thingId) {
    return;
  }

  const previous = actionsByThingId.get(thingId) || [];
  previous.forEach((action) => {
    if (action?.id) {
      actionById.delete(action.id);
    }
  });

  actionsByThingId.set(thingId, actions);
  actions.forEach((action) => {
    if (action?.id) {
      actionById.set(action.id, action);
    }
  });
};

export const registerActionProvider = (provider) => {
  if (!provider || typeof provider.discoverActions !== 'function') {
    throw new Error('Action provider must implement discoverActions(context).');
  }
  actionProviders.push(provider);
};

const discoverActions = (context = {}, options = {}) => {
  if (!context.thingDescription) {
    return [];
  }

  const aggregated = [];

  actionProviders.forEach((provider) => {
    if (typeof provider.supports === 'function' && !provider.supports(context)) {
      return;
    }

    const discovered = provider.discoverActions(context) || [];
    if (!Array.isArray(discovered) || discovered.length === 0) {
      return;
    }

    discovered.forEach((descriptor, index) => {
      const normalized = normalizeDescriptor(
        descriptor,
        context,
        provider.name || provider.id || 'action-provider',
        {
          index,
          fallbackThingId: options.fallbackThingId,
        },
      );
      aggregated.push(normalized);
    });
  });

  return aggregated;
};

export const ensureThingActions = (context = {}) => {
  const thingId = context.thingId || context.thingDescription?.id || context.fallbackThingId || null;
  if (thingId && actionsByThingId.has(thingId)) {
    return actionsByThingId.get(thingId);
  }

  const actions = discoverActions(context, { fallbackThingId: thingId });
  if (thingId) {
    saveActionsForThing(thingId, actions);
  }
  return actions;
};

export const refreshThingActions = (context = {}) => {
  const thingId = context.thingId || context.thingDescription?.id || context.fallbackThingId || null;
  const actions = discoverActions(context, { fallbackThingId: thingId });
  if (thingId) {
    saveActionsForThing(thingId, actions);
  }
  return actions;
};

export const getActionsForThing = (thingId) => {
  if (!thingId) {
    return [];
  }
  return actionsByThingId.get(thingId) || [];
};

export const getActionById = (actionId) => {
  if (!actionId) {
    return null;
  }
  return actionById.get(actionId) || null;
};

export const listRegisteredActionProviders = () => (
  actionProviders.map((provider) => provider.name || provider.id || 'action-provider')
);
