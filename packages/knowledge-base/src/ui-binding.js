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

const resolveActionForComponent = ({ component, props, candidateActions, fallbackThingId }) => {
  if (!Array.isArray(candidateActions) || candidateActions.length === 0) {
    return null;
  }

  // Only look for explicit action references, relying on the LLM to pick the right one.
  const explicitActionId = [
    props.actionId, 
    component.actionId, 
    props.targetActionId, 
    component.targetActionId,
    // If the LLM generates a full action object directly but missing transport, we handle it elsewhere,
    // but here we check if a property like 'action' is a string ID.
    typeof props.action === 'string' ? props.action : null
  ].find((value) => typeof value === 'string' && value.trim().length > 0);

  if (explicitActionId) {
    const normalized = explicitActionId.trim();
    // Try exact match or simple case-insensitive match
    const matching = candidateActions.find((action) => action.id === normalized)
      || candidateActions.find((action) => typeof action.id === 'string' && action.id.toLowerCase() === normalized.toLowerCase());
    
    if (matching) {
      return matching;
    }
    
    // If not found in candidates, construct a minimal descriptor if we can infer thingId
    return {
      id: normalized,
      thingId: fallbackThingId || deriveThingIdFromActionId(normalized),
    };
  }

  return null;
};

export const ensureActionBindings = (uiDefinition, { thingActions = [], fallbackThingId = null } = {}) => {
  if (!uiDefinition || typeof uiDefinition !== 'object') {
    return uiDefinition;
  }

  const actions = Array.isArray(thingActions) ? thingActions.filter((action) => action && action.id) : [];
  if (actions.length === 0) {
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
    // Check any component for action bindings, regardless of type
    const props = component.props && typeof component.props === 'object' ? component.props : component;

    // If an action object is already present and fully formed, we trust it or just patch thingId
    if (props.action && typeof props.action === 'object') {
        if (!props.action.thingId && fallbackThingId) {
            props.action.thingId = fallbackThingId;
        }
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

    const inferred = resolveActionForComponent({
      component,
      props,
      candidateActions,
      fallbackThingId: resolvedThingId || fallbackThingId,
    });

    if (inferred) {
      const descriptor = cloneActionDescriptor(inferred) || inferred;
      props.action = descriptor;
      if (!component.action) {
        component.action = descriptor;
      }
      if (!props.thingId && descriptor?.thingId) {
        props.thingId = descriptor.thingId;
      }
    }
  });

  return uiDefinition;
};
