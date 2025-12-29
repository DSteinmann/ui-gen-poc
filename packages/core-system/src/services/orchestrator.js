import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import {
  deviceRegistry,
  thingRegistry,
  capabilityAliasIndex,
  resolveCapabilityRecord,
  resolveEndpointConfig,
  getRegistryForType
} from './registry.js';
import { dispatchUiToClients } from '../transport/websocket.js';
import { KNOWLEDGE_BASE_URL, FALLBACK_PROMPT, DEFAULT_RESPONSE_SCHEMA_PATH } from '../config.js';
import { composeUrl, nowIsoString } from '../utils.js';
import { ensureThingActions } from '../../action-registry.js';
import { attachThingActionsToUi } from '../../ui-action-augmenter.js';

let defaultResponseSchema;
try {
  defaultResponseSchema = JSON.parse(readFileSync(DEFAULT_RESPONSE_SCHEMA_PATH, 'utf-8'));
} catch (error) {
  console.warn('[Orchestrator] Failed to load default output schema:', error.message);
  defaultResponseSchema = {};
}

// Convert the capability registry into prose the LLM can reason about when deciding to call tools.
export const summarizeCapabilitiesForPrompt = (capabilityNames = []) => {
  const uniqueCapabilities = Array.from(new Set(capabilityNames.filter(Boolean)));
  if (uniqueCapabilities.length === 0) {
    return 'No supplementary capabilities are available beyond the device itself.';
  }

  const summaries = uniqueCapabilities.map((capabilityName) => {
    const record = resolveCapabilityRecord(capabilityName);
    if (!record) {
      return `- ${capabilityName}: not currently registered; avoid referencing this capability.`;
    }

    const parts = [`- ${capabilityName}: provided by service '${record.name}' at ${record.url}`];

    if (record.metadata?.description) {
      parts.push(`  • Description: ${record.metadata.description}`);
    }

    if (record.endpoints?.default) {
      const { method = 'GET', path: endpointPath = '/' } = record.endpoints.default;
      parts.push(`  • Default endpoint: ${method.toUpperCase()} ${composeUrl(record.url, endpointPath)}`);
    }

    const toolEntries = record.tools && typeof record.tools === 'object'
      ? Object.entries(record.tools)
      : [];

    if (toolEntries.length > 0) {
      const toolLines = toolEntries.map(([toolName, descriptor]) => {
        if (!descriptor || typeof descriptor !== 'object') {
          return `    - ${toolName}`;
        }

        const { description, method = 'GET', path: endpointPath = '' } = descriptor;
        const resolvedUrl = descriptor.url || composeUrl(record.url, endpointPath || '/');
        const descLine = description ? ` — ${description}` : '';
        return `    - ${toolName} (${method.toUpperCase()} ${resolvedUrl})${descLine}`;
      });
      parts.push('  • LLM-callable tools:');
      parts.push(...toolLines);
    }

    return parts.join('\n');
  });

  return summaries.join('\n');
};

// Call each capability module once per UI generation so the UI prompt includes fresh telemetry samples.
export const collectCapabilityData = async (requestedCapabilities = [], context = {}) => {
  const capabilityData = {};
  const missingCapabilities = [];

  await Promise.all(
    requestedCapabilities.map(async (capabilityName) => {
      const moduleRecord = resolveCapabilityRecord(capabilityName);

      if (!moduleRecord) {
        missingCapabilities.push(capabilityName);
        capabilityData[capabilityName] = { error: 'Capability not registered' };
        console.warn(`[Core] Capability '${capabilityName}' is missing from the registry.`);
        return;
      }

      const endpointConfig = resolveEndpointConfig(moduleRecord);

      if (!endpointConfig) {
        capabilityData[capabilityName] = {
          source: moduleRecord.name,
          metadata: moduleRecord.metadata || null,
          note: 'No executable endpoint registered',
        };
        console.warn(`[Core] Capability '${moduleRecord.name}' registered without an executable endpoint.`);
        return;
      }

      const requestOptions = {
        method: endpointConfig.method,
        headers: { ...endpointConfig.headers },
      };

      if (endpointConfig.method !== 'GET') {
        requestOptions.headers['Content-Type'] = requestOptions.headers['Content-Type'] || 'application/json';
        requestOptions.body = JSON.stringify({ context });
      }

      try {
        console.log(`[Core] Fetching capability '${capabilityName}' from ${endpointConfig.method} ${endpointConfig.url}`);
        const response = await fetch(endpointConfig.url, requestOptions);

        if (!response.ok) {
          capabilityData[capabilityName] = {
            source: moduleRecord.name,
            error: `Capability responded with status ${response.status}`,
          };
          console.error(`[Core] Capability '${moduleRecord.name}' responded with status ${response.status}.`);
          return;
        }

        const data = await response.json();
        capabilityData[capabilityName] = {
          source: moduleRecord.name,
          data,
        };
        console.log(`[Core] Capability '${moduleRecord.name}' data received successfully.`);
      } catch (error) {
        capabilityData[capabilityName] = {
          source: moduleRecord.name,
          error: error.message,
        };
        console.error(`[Core] Error fetching capability '${moduleRecord.name}': ${error.message}`);
      }
    })
  );

  return { capabilityData, missingCapabilities };
};

export const scoreDeviceForCapabilities = (device, desiredCapabilities = []) => {
  if (!device) {
    return { matches: 0, missing: desiredCapabilities.slice(), supportsAll: false };
  }

  const supported = new Set(Array.isArray(device.capabilities) ? device.capabilities : []);
  const missing = [];
  let matches = 0;

  desiredCapabilities.forEach((capability) => {
    if (supported.has(capability)) {
      matches += 1;
    } else {
      missing.push(capability);
    }
  });

  return {
    matches,
    missing,
    supportsAll: missing.length === 0,
  };
};

// Heuristic fallback when the KB can't decide which physical device should render the UI.
export const selectTargetDevice = ({ requestedDeviceId, desiredCapabilities = [] } = {}) => {
  if (requestedDeviceId) {
    const explicitDevice = deviceRegistry.get(requestedDeviceId);
    return {
      device: explicitDevice || null,
      reason: explicitDevice ? 'explicit-device-request' : 'requested-device-not-found',
      score: scoreDeviceForCapabilities(explicitDevice, desiredCapabilities),
    };
  }

  const devices = Array.from(deviceRegistry.values());
  if (devices.length === 0) {
    return { device: null, reason: 'no-devices-registered', score: scoreDeviceForCapabilities(null, desiredCapabilities) };
  }

  if (!desiredCapabilities || desiredCapabilities.length === 0) {
    return {
      device: devices[0],
      reason: 'no-capabilities-requested',
      score: scoreDeviceForCapabilities(devices[0], desiredCapabilities),
    };
  }

  const ranked = devices
    .map((device) => ({
      device,
      score: scoreDeviceForCapabilities(device, desiredCapabilities),
    }))
    .sort((a, b) => {
      if (a.score.supportsAll && !b.score.supportsAll) return -1;
      if (!a.score.supportsAll && b.score.supportsAll) return 1;
      if (b.score.matches !== a.score.matches) {
        return b.score.matches - a.score.matches;
      }
      return (a.score.missing.length || Infinity) - (b.score.missing.length || Infinity);
    });

  const bestMatch = ranked[0];

  return {
    device: bestMatch?.device || null,
    reason: bestMatch ? 'auto-selected-best-match' : 'no-suitable-device-found',
    score: bestMatch?.score || scoreDeviceForCapabilities(null, desiredCapabilities),
  };
};

// Gather executable descriptors. Prioritize the device's bound Thing (if any) but still surface every registered Thing.
export const collectThingActionsForDevice = (deviceRecord, resolvedThingDescription) => {
  const orderedThingIds = [];
  const explicitThingId = deviceRecord?.thingId || resolvedThingDescription?.id || null;

  if (explicitThingId) {
    orderedThingIds.push(explicitThingId);
  }

  thingRegistry.forEach((thing) => {
    if (!orderedThingIds.includes(thing.id)) {
      orderedThingIds.push(thing.id);
    }
  });

  const aggregated = [];
  orderedThingIds.forEach((thingId) => {
    const registeredThing = thingRegistry.get(thingId);
    if (!registeredThing && thingId !== explicitThingId) {
      return;
    }

    const descriptionSource = thingId === explicitThingId
      ? resolvedThingDescription || registeredThing?.description
      : registeredThing?.description;

    const metadataSource = thingId === explicitThingId
      ? deviceRecord?.metadata || registeredThing?.metadata
      : registeredThing?.metadata;

    if (!descriptionSource) {
      return;
    }

    const actions = ensureThingActions({
      thingId,
      thingDescription: descriptionSource,
      metadata: metadataSource,
    });
    aggregated.push(...actions);
  });

  return aggregated;
};

export const buildDynamicPrompt = ({
  basePrompt,
  targetDevice,
  desiredCapabilities = [],
  selectionReason,
  selectionScore,
  capabilitySummary,
}) => {
  const deviceSummaries = Array.from(deviceRegistry.values()).map((device) => {
    const supportedComponents = Array.isArray(device.metadata?.supportedUiComponents)
      ? device.metadata.supportedUiComponents.join(', ')
      : 'unspecified';
    const capabilityList = Array.isArray(device.capabilities) && device.capabilities.length > 0
      ? device.capabilities.join(', ')
      : 'none';

    return `- ${device.name} (${device.id}): capabilities [${capabilityList}], components [${supportedComponents}]`;
  });

  const targetSummary = targetDevice
    ? `${targetDevice.name} (${targetDevice.id})`
    : 'none available';

  const capabilityClause = desiredCapabilities.length > 0
    ? `Requested capabilities: ${desiredCapabilities.join(', ')}.`
    : 'No explicit capability requirements were provided.';

  const selectionClause = selectionReason
    ? `Selection reason: ${selectionReason}${selectionScore?.missing?.length ? ` (missing capabilities: ${selectionScore.missing.join(', ')})` : ''}.`
    : 'Selection reason: not provided.';

  const capabilityClauseDetailed = capabilitySummary
    ? `Registered capabilities available to augment the UI:
${capabilitySummary}`
    : null;

  return [
    basePrompt,
    '---',
    'Connected device overview:',
    deviceSummaries.join('\n'),
    capabilityClause,
    `Target device for this UI: ${targetSummary}.`,
    selectionClause,
    capabilityClauseDetailed,
    'Make sure the generated UI is tailored to the target device and its capabilities.',
  ]
    .filter(Boolean)
    .join('\n\n');
};

// Ask the KB/LLM to choose a device when multiple are connected; it sees component lists, capabilities, and prompts.
export const selectDeviceViaKnowledgeBase = async ({
  prompt,
  thingDescription,
  desiredCapabilities = [],
  model,
}) => {
  const candidates = Array.from(deviceRegistry.values());
  if (candidates.length === 0) {
    return null;
  }

  const candidatePayload = candidates.map((device) => {
    const score = scoreDeviceForCapabilities(device, desiredCapabilities);
    return {
      id: device.id,
      name: device.name,
      capabilities: device.capabilities,
      metadata: {
        deviceType: device.metadata?.deviceType,
        supportsAudio: device.metadata?.supportsAudio || false,
        supportsDictation: device.metadata?.supportsDictation || false,
        supportsTouch: device.metadata?.supportsTouch || false,
        supportsTheming: device.metadata?.supportsTheming || [],
        supportedUiComponents: device.metadata?.supportedUiComponents || [],
        modalityPreference: device.metadata?.modalityPreference || null,
      },
      uiSchema: device.uiSchema
        ? {
            components: device.uiSchema.components || {},
            tools: device.uiSchema.tools || {},
            theming: device.uiSchema.theming || null,
            context: device.uiSchema.context || null,
          }
        : null,
      defaultPrompt: device.defaultPrompt,
      score,
    };
  });

  const payload = {
    prompt,
    fallbackPrompt,
    desiredCapabilities,
    thingDescription,
    candidates: candidatePayload,
    model,
  };

  try {
  const response = await fetch(`${KNOWLEDGE_BASE_URL}/select-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Core] Knowledge base device selection failed with status ${response.status}: ${errorText}`);
      return null;
    }

    const selection = await response.json();
    if (!selection?.targetDeviceId) {
      console.warn('[Core] Knowledge base device selection returned no targetDeviceId.');
      return null;
    }

    if (!deviceRegistry.has(selection.targetDeviceId)) {
      console.warn(`[Core] Knowledge base selected unknown device '${selection.targetDeviceId}'.`);
      return null;
    }

    return {
      deviceId: selection.targetDeviceId,
      reason: selection.reason || 'knowledge-base-selected-device',
      confidence: selection.confidence || 'unknown',
      alternateDeviceIds: Array.isArray(selection.alternateDeviceIds) ? selection.alternateDeviceIds : [],
      raw: selection,
    };
  } catch (error) {
    console.error('[Core] Device selection via knowledge base failed:', error.message);
    return null;
  }
};

// Main orchestrator: pick a device, gather actions/capabilities, call the KB, then ship the rendered UI back out.
export const generateUiForDevice = async ({
  deviceId,
  prompt,
  schema,
  thingDescription,
  capabilities,
  broadcast = true,
  model,
}) => {
  const requestedCapabilities = Array.isArray(capabilities) ? capabilities.filter(Boolean) : [];

  const basePrompt = prompt || FALLBACK_PROMPT;
  let targetDeviceId = deviceId || null;
  let selectionMeta = null;

  if (!targetDeviceId) {
    if (deviceRegistry.size === 1) {
      const soleDevice = deviceRegistry.values().next().value;
      targetDeviceId = soleDevice?.id || null;
      selectionMeta = {
        deviceId: targetDeviceId,
        reason: 'only-device-available',
        confidence: 'high',
        alternateDeviceIds: [],
        raw: { soleDevice: true },
        score: scoreDeviceForCapabilities(soleDevice, requestedCapabilities),
      };
    } else {
      selectionMeta = await selectDeviceViaKnowledgeBase({
        prompt: basePrompt,
        thingDescription,
        desiredCapabilities: requestedCapabilities,
        model,
      });

      if (!selectionMeta || !selectionMeta.deviceId) {
        console.warn('[Core] Falling back to heuristic device selection.');
        const heuristic = selectTargetDevice({ desiredCapabilities: requestedCapabilities });
        targetDeviceId = heuristic.device?.id || null;
        selectionMeta = {
          deviceId: targetDeviceId,
          reason: heuristic.reason,
          confidence: 'heuristic',
          alternateDeviceIds: [],
          raw: { heuristic: true },
          score: heuristic.score,
        };
      } else {
        targetDeviceId = selectionMeta.deviceId;
      }
    }
  }

  if (!targetDeviceId) {
    throw new Error('No suitable device available for UI generation.');
  }

  const targetDevice = deviceRegistry.get(targetDeviceId);

  if (!targetDevice) {
    throw new Error(`Unknown device '${targetDeviceId}'.`);
  }

  if (!selectionMeta) {
    selectionMeta = {
      deviceId: targetDeviceId,
      reason: 'explicit-device-request',
      confidence: 'certain',
      alternateDeviceIds: [],
      raw: { explicit: true },
    };
  }

  const selectionScore = scoreDeviceForCapabilities(targetDevice, requestedCapabilities);
  selectionMeta.score = selectionScore;

  let resolvedCapabilities = requestedCapabilities.length > 0
    ? requestedCapabilities
    : Array.isArray(targetDevice.capabilities)
      ? targetDevice.capabilities
      : [];

  if (!resolvedCapabilities || resolvedCapabilities.length === 0) {
    resolvedCapabilities = Array.from(capabilityAliasIndex.keys());
  }

  const basePromptForUi = prompt || targetDevice?.defaultPrompt || FALLBACK_PROMPT;
  const capabilitySummary = summarizeCapabilitiesForPrompt(resolvedCapabilities);
  const resolvedPrompt = buildDynamicPrompt({
    basePrompt: basePromptForUi,
    targetDevice,
    desiredCapabilities: resolvedCapabilities,
    selectionReason: selectionMeta.reason,
    selectionScore,
    capabilitySummary,
  });

  const resolvedSchema = schema && Object.keys(schema).length > 0
    ? schema
    : targetDevice?.uiSchema
      ? { ...targetDevice.uiSchema }
      : { components: {} };

  if (!resolvedSchema.name) {
    resolvedSchema.name = targetDevice.id;
  }

  const resolvedResponseSchema =
    (resolvedSchema && typeof resolvedSchema === 'object'
      && (resolvedSchema.responseSchema || resolvedSchema.outputSchema || resolvedSchema.jsonSchema))
      || defaultResponseSchema;

  resolvedSchema.responseSchema = resolvedResponseSchema;

  const capabilityTools = {};
  resolvedCapabilities.forEach((capabilityName) => {
    const capabilityRecord = resolveCapabilityRecord(capabilityName);
    if (!capabilityRecord?.tools) {
      return;
    }

    Object.entries(capabilityRecord.tools).forEach(([toolName, descriptor]) => {
      if (!descriptor || typeof descriptor !== 'object') {
        return;
      }

      const toolDescriptor = { ...descriptor };
      toolDescriptor.capability = toolDescriptor.capability || capabilityName;
      toolDescriptor.service = toolDescriptor.service || capabilityRecord.name;

      if (!toolDescriptor.url) {
        if (toolDescriptor.path) {
          toolDescriptor.url = composeUrl(capabilityRecord.url, toolDescriptor.path);
        } else {
          toolDescriptor.url = capabilityRecord.url;
        }
      }

      capabilityTools[toolName] = toolDescriptor;
    });
  });

  const existingToolConfig = resolvedSchema && typeof resolvedSchema === 'object' && resolvedSchema.tools && typeof resolvedSchema.tools === 'object'
    ? { ...resolvedSchema.tools }
    : {};

  const mergedToolConfig = Object.keys(capabilityTools).length > 0 || Object.keys(existingToolConfig).length > 0
    ? { ...capabilityTools, ...existingToolConfig }
    : {};

  if (Object.keys(mergedToolConfig).length > 0) {
    resolvedSchema.tools = mergedToolConfig;
  } else if (resolvedSchema.tools) {
    delete resolvedSchema.tools;
  }

  if (Object.keys(mergedToolConfig).length > 0) {
    const toolCapabilitySet = new Set(resolvedCapabilities);
    Object.values(mergedToolConfig).forEach((toolDescriptor) => {
      const capabilityName = toolDescriptor?.capability || toolDescriptor?.capabilityAlias || toolDescriptor?.provides;
      if (capabilityName) {
        toolCapabilitySet.add(capabilityName);
      }
    });
    resolvedCapabilities = Array.from(toolCapabilitySet);
  }

  let resolvedThingDescription = thingDescription || null;
  if (!resolvedThingDescription && targetDevice?.thingDescription) {
    resolvedThingDescription = targetDevice.thingDescription;
  }
  if (!resolvedThingDescription && targetDevice?.thingId) {
    const registeredThing = thingRegistry.get(targetDevice.thingId);
    if (registeredThing && registeredThing.description) {
      resolvedThingDescription = registeredThing.description;
    }
  }

  const normalizedThingActions = collectThingActionsForDevice(targetDevice, resolvedThingDescription);

  const availableThings = Array.from(thingRegistry.values()).map((thing) => ({
    id: thing.id,
    title: thing.description?.title || thing.metadata?.deviceType || thing.id,
    description: thing.description,
    metadata: thing.metadata,
  }));

  const { capabilityData, missingCapabilities } = await collectCapabilityData(resolvedCapabilities, {
    prompt: resolvedPrompt,
    deviceId: targetDeviceId,
    device: targetDevice,
  });

  const toolConfig = (resolvedSchema && typeof resolvedSchema === 'object') ? resolvedSchema.tools || {} : {};
  const capabilityToolHints = {};
  Object.entries(toolConfig).forEach(([toolName, config]) => {
    if (config && typeof config === 'object') {
      const capabilityKey = config.capability || config.capabilityAlias || config.provides;
      if (capabilityKey) {
        capabilityToolHints[capabilityKey] = toolName;
      }
    }
  });

  const sanitizedCapabilityData = {};
  Object.entries(capabilityData).forEach(([capabilityName, details]) => {
    const toolName = capabilityToolHints[capabilityName];
    if (toolName) {
      sanitizedCapabilityData[capabilityName] = {
        note: `Use tool '${toolName}' to retrieve the latest data for capability '${capabilityName}'.`,
        ...(details?.error ? { error: details.error } : {}),
        ...(details?.data !== undefined ? { cachedSample: details.data } : {}),
      };
    } else {
      sanitizedCapabilityData[capabilityName] = details;
    }
  });

  const knowledgeBasePayload = {
    prompt: resolvedPrompt,
    schema: resolvedSchema,
    thingDescription: resolvedThingDescription,
    capabilities: resolvedCapabilities,
    capabilityData: sanitizedCapabilityData,
    missingCapabilities,
    deviceId: targetDeviceId,
    device: targetDevice,
    selection: {
      reason: selectionMeta.reason,
      score: selectionMeta.score,
      confidence: selectionMeta.confidence,
      alternateDeviceIds: selectionMeta.alternateDeviceIds,
      consideredDevices: Array.from(deviceRegistry.keys()),
      raw: selectionMeta.raw,
      targetDeviceId,
    },
    thingActions: normalizedThingActions,
    availableThings,
  };

  console.log(`[Core] Generating UI for device '${targetDeviceId}' with capabilities: ${resolvedCapabilities.join(', ') || 'none'} (reason: ${selectionMeta.reason})`);

  let requirementKnowledgeBaseResponse;
  try {
  requirementKnowledgeBaseResponse = await fetch(`${KNOWLEDGE_BASE_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(knowledgeBasePayload),
    });
  } catch (error) {
    console.error('[Core] Failed to reach knowledge base service:', error.message);
    throw new Error(`Knowledge base unreachable: ${error.message}`);
  }

  if (!requirementKnowledgeBaseResponse.ok) {
    const errorBody = await requirementKnowledgeBaseResponse.text();
    console.error(`[Core] Knowledge base responded with status ${requirementKnowledgeBaseResponse.status}: ${errorBody}`);
    throw new Error(`Knowledge base error (${requirementKnowledgeBaseResponse.status})`);
  }

  console.log('[Core] Knowledge base responded successfully; parsing UI payload.');

  let generatedUi = await requirementKnowledgeBaseResponse.json();

  if (!generatedUi || Object.keys(generatedUi).length === 0) {
    generatedUi = {
      type: 'container',
      children: [
        { type: 'text', content: 'Error: UI generation failed. The generated UI is empty.' },
      ],
    };
  }

  generatedUi = attachThingActionsToUi(generatedUi, {
    thingActions: normalizedThingActions,
    defaultThingId: targetDevice?.thingId || resolvedThingDescription?.id || null,
  });

  if (broadcast) {
    dispatchUiToClients(targetDeviceId, generatedUi);
    console.log(`[Core] Dispatched UI to device '${targetDeviceId}'.`);
  }

  return generatedUi;
};

// Whenever a Thing registers or updates, reflow the UI for any device that's pinned to it.
export const refreshDevicesAssociatedWithThing = (thingId) => {
  if (!thingId) {
    return;
  }

  deviceRegistry.forEach((deviceRecord) => {
    const associatedThingId = deviceRecord.thingId || deviceRecord.thingDescription?.id || null;
    if (associatedThingId === thingId) {
      generateUiForDevice({ deviceId: deviceRecord.id })
        .then(() => {
          console.log(`[Core] Regenerated UI for device '${deviceRecord.id}' after thing '${thingId}' registration.`);
        })
        .catch((error) => {
          console.error(`Failed to refresh UI for device ${deviceRecord.id} after thing '${thingId}' registration:`, error.message);
        });
    }
  });
};
