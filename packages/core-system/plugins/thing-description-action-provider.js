const arrayify = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [value];
};

const resolveBaseUrl = (thingDescription = {}) => {
  if (typeof thingDescription.base === 'string' && thingDescription.base.length > 0) {
    return thingDescription.base.endsWith('/') ? thingDescription.base.slice(0, -1) : thingDescription.base;
  }
  if (typeof thingDescription.baseUrl === 'string' && thingDescription.baseUrl.length > 0) {
    return thingDescription.baseUrl.endsWith('/') ? thingDescription.baseUrl.slice(0, -1) : thingDescription.baseUrl;
  }
  return '';
};

const resolveAbsoluteUrl = (baseUrl, href) => {
  if (!href) {
    return baseUrl;
  }
  if (/^https?:/i.test(href)) {
    return href;
  }
  if (!baseUrl) {
    return href;
  }
  if (href.startsWith('/')) {
    return `${baseUrl}${href}`;
  }
  return `${baseUrl}/${href}`;
};

const inferMethodFromOps = (ops = []) => {
  const opList = arrayify(ops).map((op) => (typeof op === 'string' ? op.toLowerCase() : op));
  if (opList.includes('readproperty') || opList.includes('readallproperties')) {
    return 'GET';
  }
  if (opList.includes('writeproperty') || opList.includes('writeallproperties')) {
    return 'PUT';
  }
  if (opList.includes('invokeaction')) {
    return 'POST';
  }
  return null;
};

const normalizeForms = ({ forms = [], baseUrl, defaultMethod = 'POST', defaultContentType = 'application/json' }) => {
  return arrayify(forms)
    .filter(Boolean)
    .map((form, index) => {
      const method = (form.method || inferMethodFromOps(form.op) || defaultMethod || 'POST').toUpperCase();
      const href = form.href || form.uri || form.url || '';
      return {
        id: form.id || `form-${index}`,
        href,
        url: resolveAbsoluteUrl(baseUrl, href),
        method,
        contentType: form.contentType || defaultContentType,
        op: arrayify(form.op),
        security: form.security,
        subprotocol: form.subprotocol,
        metadata: form.metadata ? { ...form.metadata } : undefined,
      };
    });
};

const buildActionDescriptor = (thingContext, actionName, definition = {}) => {
  const baseUrl = resolveBaseUrl(thingContext.thingDescription);
  const actionTitle = definition.title || actionName;
  const forms = normalizeForms({
    forms: definition.forms,
    baseUrl,
    defaultMethod: 'POST',
    defaultContentType: definition.contentType || 'application/json',
  });

  const descriptorMetadata = {
    base: baseUrl,
    thingTitle: thingContext.thingDescription?.title,
    ...(definition.metadata && typeof definition.metadata === 'object' ? definition.metadata : {}),
  };

  return {
    id: definition.id || `${thingContext.thingId || thingContext.thingDescription?.id || 'thing'}::${actionName}`,
    name: actionName,
    title: actionTitle,
    description: definition.description || '',
    capability: definition['@type'] || null,
    input: definition.input || null,
    output: definition.output || null,
    annotations: {
      op: forms.reduce((acc, form) => acc.concat(form.op || []), []),
    },
    transport: forms[0] || null,
    forms,
    security: thingContext.thingDescription?.security,
    metadata: descriptorMetadata,
    source: 'thing-description',
    thingId: thingContext.thingId || thingContext.thingDescription?.id || null,
  };
};

const thingDescriptionActionProvider = {
  name: 'thing-description-action-provider',
  supports: (context = {}) => Boolean(context.thingDescription && context.thingDescription.actions),
  discoverActions: (context = {}) => {
    const actions = context.thingDescription?.actions;
    if (!actions || typeof actions !== 'object') {
      return [];
    }

    return Object.entries(actions).map(([actionName, definition]) =>
      buildActionDescriptor(context, actionName, definition || {})
    );
  },
};

export default thingDescriptionActionProvider;
