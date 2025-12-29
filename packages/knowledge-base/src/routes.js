import express from 'express';
import { Buffer } from 'buffer';
import { addDocument, getDocuments } from './store.js';
import { resolveLlmConfiguration, runDeviceSelection, runAgent } from './llm.js';
import { ensureActionBindings } from './ui-binding.js';

const router = express.Router();

const encodeHeaderPayload = (payload) => {
  try {
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  } catch (_error) {
    return '';
  }
};

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', documents: getDocuments().length });
});

router.get('/documents', (req, res) => {
  res.json({ count: getDocuments().length, documents: getDocuments() });
});

router.post('/documents', (req, res) => {
  try {
    const { id, content, metadata, tags } = req.body;
    const record = addDocument({ id, content, metadata, tags });
    res.status(201).json({ status: 'stored', document: record });
  } catch (error) {
    console.error('[Routes] Error storing document:', error);
    res.status(400).json({ error: error.message });
  }
});

router.get('/llm-config', (_req, res) => {
  res.json(resolveLlmConfiguration());
});

let lastDeviceSelection = null;

// Core posts here when it wants the KB/LLM to choose the best rendering device.
router.post('/select-device', async (req, res) => {
  const {
    prompt,
    fallbackPrompt,
    desiredCapabilities,
    thingDescription,
    candidates,
    model,
  } = req.body || {};

  try {
    const selection = await runDeviceSelection({
      prompt,
      fallbackPrompt,
      desiredCapabilities,
      thingDescription,
      candidates,
      model,
    });
    
    lastDeviceSelection = {
      timestamp: new Date().toISOString(),
      request: {
        prompt,
        fallbackPrompt,
        desiredCapabilities,
        thingDescription,
        candidates,
        model,
      },
      response: selection,
    };

    console.log(`[KB] Device selection chose '${selection?.targetDeviceId || 'unknown'}' with confidence ${selection?.confidence || 'unspecified'}.`);
    res.json(selection);
  } catch (error) {
    console.error('[KB] Device selection failed:', error);
    res.status(500).json({ error: 'Device selection failed', details: error.message });
  }
});

router.get('/debug/last-device-selection', (req, res) => {
  if (!lastDeviceSelection) {
    return res.status(404).json({ error: 'No device selection has been recorded yet.' });
  }
  res.json(lastDeviceSelection);
});

// Main UI-generation entrypoint: core submits schema/actions, KB returns the LLM-crafted UI JSON.
router.post('/query', async (req, res) => {
  const { prompt, thingDescription, capabilities, schema, capabilityData, missingCapabilities, device, deviceId, selection, thingActions, availableThings } = req.body;
  console.log('[KB] /query invoked', {
    promptPreview: typeof prompt === 'string' ? `${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}` : null,
    capabilities,
    deviceId: deviceId || null,
  });

  try {
    const { uiDefinition, meta } = await runAgent({
      prompt,
      thingDescription,
      capabilities,
      uiSchema: schema || {},
      capabilityData,
      missingCapabilities,
      device,
      deviceId,
      selection,
      thingActions,
      availableThings,
    });

    let generatedUi = uiDefinition;

    if (generatedUi) {
      const fallbackThingId = device?.thingId
        || (Array.isArray(thingActions) && thingActions[0]?.thingId)
        || null;
      generatedUi = ensureActionBindings(generatedUi, { thingActions, fallbackThingId });
    }

    if (!generatedUi || Object.keys(generatedUi).length === 0) {
      generatedUi = {
        type: 'container',
        children: [
          { type: 'text', content: 'Error: UI generation failed. The generated UI is empty.' },
        ],
      };
    }
    
    // I'll add the meta headers
    if (meta) {
      if (meta.provider) res.set('X-KB-LLM-Provider', String(meta.provider));
      if (meta.model) res.set('X-KB-LLM-Model', String(meta.model));
      if (typeof meta.durationMs === 'number' && Number.isFinite(meta.durationMs)) {
        res.set('X-KB-LLM-Call-Duration', String(meta.durationMs));
      }
      const usageJson = meta.usage && typeof meta.usage === 'object' ? JSON.stringify(meta.usage) : null;
      if (usageJson) res.set('X-KB-LLM-Usage', usageJson);
      const encodedMeta = encodeHeaderPayload(meta);
      if (encodedMeta) res.set('X-KB-LLM-Meta', encodedMeta);
    }

    console.log('[KB] Returning generated UI payload.');
    // We'll return the UI directly for now, binding will happen in next step refactor
    res.json(generatedUi);
  } catch (error) {
    console.error('Error communicating with LLM:', error);
    res.status(500).json({ error: 'Failed to generate UI with LLM', details: error.message });
  }
});

export default router;
