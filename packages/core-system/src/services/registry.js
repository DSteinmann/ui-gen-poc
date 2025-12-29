import { normalizeUrl, composeUrl, nowIsoString } from '../utils.js';
import { ensureThingActions, getActionsForThing } from '../../action-registry.js';

export const serviceRegistryByType = {
  generic: new Map(),
  capability: new Map(),
  device: new Map(),
};

export const capabilityAliasIndex = new Map();
export const deviceRegistry = new Map();
export const thingRegistry = new Map();

// Event listeners to decouple orchestration
const listeners = {
  serviceRegistered: [],
  thingRegistered: [],
  deviceRegistered: [],
};

export const onServiceRegistered = (fn) => listeners.serviceRegistered.push(fn);
export const onThingRegistered = (fn) => listeners.thingRegistered.push(fn);
export const onDeviceRegistered = (fn) => listeners.deviceRegistered.push(fn);

const unregisterCapabilityAliases = (record) => {
  if (!record?.provides) return;
  record.provides.forEach((alias) => {
    if (capabilityAliasIndex.get(alias) === record.name) {
      capabilityAliasIndex.delete(alias);
    }
  });
};

const normalizeEndpoints = (endpoints = {}, directEndpoint) => {
  const normalized = { ...endpoints };
  if (directEndpoint) {
    normalized.default = directEndpoint;
  }
  return normalized;
};

export const getRegistryForType = (type = 'generic') => {
  if (type === 'capability') return serviceRegistryByType.capability;
  if (type === 'device') return serviceRegistryByType.device;
  return serviceRegistryByType.generic;
};

export const resolveCapabilityRecord = (capabilityName) => {
  if (!capabilityName) {
    return null;
  }

  const moduleName = capabilityAliasIndex.get(capabilityName) || capabilityName;
  return serviceRegistryByType.capability.get(moduleName) || null;
};

export const resolveEndpointConfig = (moduleRecord) => {
  if (!moduleRecord) return null;

  const endpoints = moduleRecord.endpoints || {};
  const endpointConfig = endpoints.default || endpoints.invoke || moduleRecord.endpoint;

  if (!endpointConfig) return null;

  if (typeof endpointConfig === 'string') {
    return {
      url: composeUrl(moduleRecord.url, endpointConfig),
      method: 'GET',
      headers: {},
    };
  }

  const { path = '/', method = 'GET', headers = {} } = endpointConfig;

  return {
    url: composeUrl(moduleRecord.url, path),
    method: (method || 'GET').toUpperCase(),
    headers,
  };
};

export const registerService = ({
  name,
  url,
  metadata = {},
  capabilities = [],
  type = 'generic',
  endpoints,
  provides,
}) => {
  if (!name || !url) {
    throw new Error('Service registration requires `name` and `url`.');
  }

  const registry = getRegistryForType(type);

  const normalizedUrl = normalizeUrl(url);
  const existing = registry.get(name);
  const now = nowIsoString();

  const record = {
    name,
    url: normalizedUrl,
    metadata: Object.keys(metadata).length > 0 ? metadata : existing?.metadata || {},
    capabilities: Array.isArray(capabilities) && capabilities.length > 0
      ? capabilities
      : existing?.capabilities || [],
    registeredAt: existing?.registeredAt || now,
    lastHeartbeat: now,
    type,
  };

  if (type === 'capability') {
    const resolvedProvides = Array.isArray(provides) && provides.length > 0
      ? provides
      : Array.isArray(existing?.provides) ? existing.provides : [];

    record.provides = resolvedProvides;

    const resolvedEndpoints = endpoints && Object.keys(endpoints).length > 0
      ? endpoints
      : existing?.endpoints || {};

    record.endpoints = resolvedEndpoints;
  }

  registry.set(name, record);

  if (type === 'capability') {
    // Also store un-aliased mapping if needed, but here we store by name
    serviceRegistryByType.capability.set(name, record);
    
    // Manage aliases
    if (existing) {
       unregisterCapabilityAliases(existing);
    }
    record.provides.forEach((alias) => {
      capabilityAliasIndex.set(alias, name);
    });
  }

  listeners.serviceRegistered.forEach((fn) => fn(record));

  return record;
};

// Specialized registration for Things
export const registerThing = ({ id, description, metadata = {}, lastHeartbeat }) => {
  if (!id || !description) {
    throw new Error('Thing registration requires `id` and `description`.');
  }

  const record = {
    id,
    description,
    metadata,
    registeredAt: nowIsoString(),
    lastHeartbeat: lastHeartbeat || nowIsoString(),
  };

  record.actions = ensureThingActions({ thingId: id, thingDescription: description, metadata });
  thingRegistry.set(id, record);
  
  listeners.thingRegistered.forEach(fn => fn(record));
  
  return record;
};

// Specialized registration for Devices
export const registerDevice = ({ id, name, url, thingId, thingDescription, capabilities = [], metadata = {}, uiSchema, defaultPrompt, resolvedDefaultPrompt, fallbackPrompt }) => {
  if (!id || !name) {
    throw new Error('Device registration requires `id` and `name`.');
  }

  const effectiveDefaultPrompt = defaultPrompt || metadata.defaultPrompt || resolvedDefaultPrompt || fallbackPrompt;

  const record = {
    id,
    name,
    url: url ? normalizeUrl(url) : undefined,
    thingDescription,
    thingId,
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    metadata,
    uiSchema: uiSchema || metadata.uiSchema || null,
    defaultPrompt: effectiveDefaultPrompt || null,
    registeredAt: nowIsoString(),
    lastHeartbeat: nowIsoString(),
  };

  const resolvedThingId = thingId || thingDescription?.id || null;
  if (thingDescription) {
    ensureThingActions({ thingId: resolvedThingId, thingDescription, metadata });
  } else if (thingId) {
    const registeredThing = thingRegistry.get(thingId);
    if (registeredThing?.description) {
      ensureThingActions({ thingId, thingDescription: registeredThing.description, metadata: registeredThing.metadata });
    }
  }

  deviceRegistry.set(id, record);
  serviceRegistryByType.device.set(id, {
    name: id,
    url: record.url,
    metadata: metadata,
    capabilities: record.capabilities,
    registeredAt: record.registeredAt,
    lastHeartbeat: record.lastHeartbeat,
    type: 'device',
  });

  listeners.deviceRegistered.forEach(fn => fn(record));

  return record;
};

export const registrySnapshot = () => ({
  capabilities: Array.from(serviceRegistryByType.capability.values()),
  devices: Array.from(serviceRegistryByType.device.values()),
  services: Array.from(serviceRegistryByType.generic.values()),
  things: Array.from(thingRegistry.values()).map((thing) => ({
    id: thing.id,
    metadata: thing.metadata,
    registeredAt: thing.registeredAt,
    lastHeartbeat: thing.lastHeartbeat,
    actions: getActionsForThing(thing.id),
  })),
});

export const findService = (name) => {
  return (
    serviceRegistryByType.generic.get(name) ||
    serviceRegistryByType.capability.get(name) ||
    serviceRegistryByType.device.get(name)
  );
};
