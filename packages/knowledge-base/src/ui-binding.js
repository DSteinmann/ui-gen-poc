
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

const INTERACTIVE_COMPONENT_TYPES = new Set(['button', 'toggle', 'slider', 'dropdown']);

const normalizeLabelString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const tokenizeLabel = (label = '') => {
  if (!label) {
    return [];
  }
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
};

const ACTION_KEYWORD_RULES = [
  { regex: /\bturn\s*on\b|\bpower\s*on\b|\benable\b|\bstart\b/, fragment: 'turnon' },
  { regex: /\bturn\s*off\b|\bpower\s*off\b|\bdisable\b|\bstop\b/, fragment: 'turnoff' },
  { regex: /\btoggle\b|\bswitch\b/, fragment: 'toggle' },
  { regex: /\bdrive\b|\bwheel\b|\bmove\b|\btractor\b/, fragment: 'setwheelcontrol' },
];

const actionKeywordCache = new WeakMap();

const getActionKeywords = (action) => {
  if (!action || typeof action !== 'object') {
    return new Set();
  }

  if (actionKeywordCache.has(action)) {
    return actionKeywordCache.get(action);
  }

  const sources = [
    action.id,
    action.name,
    action.title,
    ...(Array.isArray(action.metadata?.intentAliases) ? action.metadata.intentAliases : []),
  ];

  const tokens = new Set();
  sources.forEach((source) => {
    if (typeof source !== 'string') {
      return;
    }
    source
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .forEach((token) => tokens.add(token));
  });

  actionKeywordCache.set(action, tokens);
  return tokens;
};

const includesActionFragment = (action, fragment) => {
  if (!action || !fragment) {
    return false;
  }

  const normalizedFragment = fragment.toLowerCase();
  const comparisonFields = [
    action.id,
    action.name,
    action.title,
    ...(Array.isArray(action.metadata?.intentAliases) ? action.metadata.intentAliases : []),
  ];

  return comparisonFields.some((field) =>
    typeof field === 'string' && field.toLowerCase().includes(normalizedFragment)
  );
};

const matchActionByHint = (hint, actions = []) => {
  if (typeof hint !== 'string') {
    return null;
  }
  const normalized = hint.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return actions.find((action) => includesActionFragment(action, normalized)) || null;
};

const scoreActionCandidate = ({ action, labelLower, labelTokens, componentType }) => {
  if (!action || !labelLower) {
    return 0;
  }

  let score = 0;
  ACTION_KEYWORD_RULES.forEach((rule) => {
    if (rule.regex.test(labelLower) && includesActionFragment(action, rule.fragment)) {
      score += 5;
    }
  });

  const actionKeywords = getActionKeywords(action);
  labelTokens.forEach((token) => {
    if (actionKeywords.has(token)) {
      score += 1;
    }
  });

  const actionIdLower = typeof action.id === 'string' ? action.id.toLowerCase() : '';
  if (componentType === 'toggle' && actionIdLower.includes('toggle')) {
    score += 2;
  }
  if (componentType === 'slider' && actionIdLower.includes('wheelcontrol')) {
    score += 2;
  }

  return score;
};

const cloneActionDescriptor = (action = {}) => {
  if (!action || typeof action !== 'object') {
    return null;
  }

  const descriptor = {
    type: action.type || 'thingAction',
    id: action.id,
    thingId: action.thingId || deriveThingIdFromActionId(action.id),
  };

  if (action.name) descriptor.name = action.name;
  if (action.title) descriptor.title = action.title;
  if (action.description) descriptor.description = action.description;
  if (action.metadata) descriptor.metadata = JSON.parse(JSON.stringify(action.metadata));
  if (action.transport) descriptor.transport = JSON.parse(JSON.stringify(action.transport));
  if (action.forms) descriptor.forms = JSON.parse(JSON.stringify(action.forms));
  if (action.headers) descriptor.headers = JSON.parse(JSON.stringify(action.headers));

  return descriptor;
};

const traverseComponents = (node, visitor) => {
  const seen = new Set();
  const visit = (element) => {
    if (!element || seen.has(element)) {
      return;
    }

    if (Array.isArray(element)) {
      element.forEach((child) => visit(child));
      return;
    }

    if (typeof element !== 'object') {
      return;
    }

    seen.add(element);
    visitor(element);

    const childCollections = [];
    if (Array.isArray(element.components)) {
      childCollections.push(element.components);
    } else if (element.components) {
      childCollections.push([element.components]);
    }

    if (Array.isArray(element.children)) {
      childCollections.push(element.children);
    } else if (element.children) {
      childCollections.push([element.children]);
    }

    const props = element.props;
    if (props && typeof props === 'object') {
      if (Array.isArray(props.components)) {
        childCollections.push(props.components);
      } else if (props.components) {
        childCollections.push([props.components]);
      }

      if (Array.isArray(props.children)) {
        childCollections.push(props.children);
      } else if (props.children) {
        childCollections.push([props.children]);
      }
    }

    childCollections.forEach((collection) => visit(collection));
  };

  visit(node);
  return node;
};

const inferActionForComponent = ({ component, props, type, candidateActions, fallbackThingId }) => {
  if (!Array.isArray(candidateActions) || candidateActions.length === 0) {
    return null;
  }

  const explicitActionId = [props.actionId, component.actionId, props.targetActionId, component.targetActionId]
    .find((value) => typeof value === 'string' && value.trim().length > 0);

  if (explicitActionId) {
    const normalized = explicitActionId.trim();
    const matching = candidateActions.find((action) => action.id === normalized)
      || candidateActions.find((action) => typeof action.id === 'string' && action.id.toLowerCase() === normalized.toLowerCase());
    if (matching) {
      return matching;
    }
    return {
      id: normalized,
      thingId: fallbackThingId || deriveThingIdFromActionId(normalized),
    };
  }

  const hintMatch =
    matchActionByHint(props.intent, candidateActions)
    || matchActionByHint(component.intent, candidateActions)
    || matchActionByHint(props.command, candidateActions)
    || matchActionByHint(component.command, candidateActions);

  if (hintMatch) {
    return hintMatch;
  }

  const label = normalizeLabelString(
    props.label
      || props.text
      || props.title
      || props.name
      || component.label
      || component.text
      || component.title,
  );

  const labelLower = label ? label.toLowerCase() : '';
  const labelTokens = tokenizeLabel(labelLower);

  if (labelLower) {
    let bestAction = null;
    let bestScore = 0;
    candidateActions.forEach((action) => {
      const score = scoreActionCandidate({ action, labelLower, labelTokens, componentType: type });
      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    });
    if (bestAction && bestScore > 0) {
      return bestAction;
    }
  }

  if (candidateActions.length === 1) {
    return candidateActions[0];
  }

  return null;
};

export const ensureActionBindings = (uiDefinition, { thingActions = [], fallbackThingId = null } = {}) => {
  const actions = Array.isArray(thingActions) ? thingActions.filter((action) => action && action.id) : [];
  if (!uiDefinition || actions.length === 0) {
    return uiDefinition;
  }

  const actionsByThingId = new Map();
  actions.forEach((action) => {
    const thingId = action.thingId || deriveThingIdFromActionId(action.id) || fallbackThingId;
    if (!thingId) {
      return;
    }
    if (!actionsByThingId.has(thingId)) {
      actionsByThingId.set(thingId, []);
    }
    actionsByThingId.get(thingId).push(action);
  });

  traverseComponents(uiDefinition, (component) => {
    const type = component.component || component.type;
    if (!type || !INTERACTIVE_COMPONENT_TYPES.has(type)) {
      return;
    }

    const props = component.props && typeof component.props === 'object' ? component.props : component;

    if (props.action) {
      if (!component.action) {
        component.action = props.action;
      }
      return;
    }

    const resolvedThingId =
      props.thingId
      || component.thingId
      || component.context?.thingId
      || fallbackThingId
      || null;

    const candidateActions = resolvedThingId && actionsByThingId.has(resolvedThingId)
      ? actionsByThingId.get(resolvedThingId)
      : actions;

    const inferred = inferActionForComponent({
      component,
      props,
      type,
      candidateActions,
      fallbackThingId: resolvedThingId || fallbackThingId,
    });

    if (!inferred) {
      console.warn(`[UiBinding] Interactive component '${props.label || type}' is missing an action binding.`);
      return;
    }

    const descriptor = cloneActionDescriptor(inferred) || inferred;
    props.action = descriptor;
    if (!component.action) {
      component.action = descriptor;
    }
    if (!props.thingId && descriptor?.thingId) {
      props.thingId = descriptor.thingId;
    }
  });

  return uiDefinition;
};
