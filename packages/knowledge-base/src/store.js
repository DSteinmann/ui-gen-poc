import fs from 'fs';
import path from 'path';
import { DATA_FILE } from './config.js';
import { tokenize, buildTermFrequency } from './rag.js';

let documents = [];

const ensureDataFile = () => {
  const dataDir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ documents: [] }, null, 2), 'utf-8');
  }
};

const persistDocuments = (docs) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ documents: docs }, null, 2), 'utf-8');
};

const normalizeScalarToken = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const token = value.trim().toLowerCase();
  return token.length ? token : null;
};

export const loadDocuments = () => {
  ensureDataFile();
  try {
    const content = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    documents = Array.isArray(parsed.documents) ? parsed.documents : [];
  } catch (error) {
    console.error('[Store] Failed to load documents:', error);
    documents = [];
  }
  return documents;
};

export const nowIsoString = () => new Date().toISOString();

export const addDocument = ({ id, content, metadata = {}, tags = [] }) => {
  if (!content || typeof content !== 'string') {
    throw new Error('Document `content` must be a non-empty string.');
  }

  const docId = id || `doc-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const tokens = tokenize(content);
  const termFrequency = buildTermFrequency(tokens);

  const record = {
    id: docId,
    content,
    metadata,
    tags,
    tokens,
    termFrequency,
    updatedAt: nowIsoString(),
    createdAt:
      documents.find((doc) => doc.id === docId)?.createdAt || nowIsoString(),
  };

  // Update existing or push new
  const existingIndex = documents.findIndex((d) => d.id === docId);
  if (existingIndex >= 0) {
    documents[existingIndex] = record;
  } else {
    documents.push(record);
  }
  
  persistDocuments(documents);
  return record;
};

export const getDocuments = () => documents;

const seedDocuments = [
  {
    id: 'modality-guideline-hands-occupied',
    content:
      'When the user activity sensor reports the state "hands-occupied", prefer audio-first guidance. Provide spoken prompts and minimize the need for direct touch input. When the sensor reports "hands-free", present tactile controls such as buttons or toggles for the light switch.',
    metadata: {
      source: 'safety-guidelines',
      version: '1.0.0',
    },
    tags: ['modality', 'hands-occupied', 'audio', 'light-switch'],
  },
  {
    id: 'user-preference-primary-color',
    content:
      'The primary household preference for interface accents is the color "#808080" (a grey). Whenever possible, set the UI theme primary color to this value so buttons, toggles, and other interactive highlights align with the user preference. Ensure sufficient contrast by using light text on dark backgrounds.',
    metadata: {
      source: 'user-profile',
      version: '2025.10',
    },
    tags: ['preference', 'theme', 'primary-color', 'personalization'],
  },
];

export const seedKnowledgeBase = () => {
  seedDocuments.forEach((doc) => {
    if (!documents.some((entry) => entry.id === doc.id)) {
      addDocument(doc);
      console.log(`[Store] Seeded knowledge base document: ${doc.id}`);
    }
  });
};

const PREFERENCE_TAG_KEYWORDS = ['preference', 'preferences', 'user-preference', 'user-preferences', 'personalization'];

const matchesPreferenceTag = (tag) => {
  if (typeof tag !== 'string') {
    return false;
  }
  const normalized = tag.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return PREFERENCE_TAG_KEYWORDS.some((keyword) => normalized === keyword || normalized.includes(keyword));
};

const isPreferenceMetadataValue = (value) => {
  const token = normalizeScalarToken(value);
  if (!token) {
    return false;
  }
  return token.includes('preference') || token.includes('profile');
};

const isUserPreferenceDocument = (doc) => {
  if (!doc || typeof doc !== 'object') {
    return false;
  }

  const hasPreferenceTag = Array.isArray(doc.tags) && doc.tags.some(matchesPreferenceTag);
  const metadata = doc.metadata || {};
  const hasPreferenceMetadata = isPreferenceMetadataValue(metadata.source)
    || isPreferenceMetadataValue(metadata.category)
    || isPreferenceMetadataValue(metadata.type);

  return hasPreferenceTag || hasPreferenceMetadata;
};

export const getUserPreferenceDocuments = () => documents.filter(isUserPreferenceDocument);

export const buildUserPreferenceContext = () => {
  const preferenceDocuments = getUserPreferenceDocuments().filter((doc) => typeof doc?.content === 'string' && doc.content.trim().length > 0);
  if (!preferenceDocuments.length) {
    return null;
  }

  return preferenceDocuments
    .map((doc) => {
      const sourceLabel = doc.metadata?.source || doc.metadata?.category || doc.id || 'user-preference';
      return `Preference (${sourceLabel}):\n${doc.content.trim()}`;
    })
    .join('\n\n');
};

// Initialize
loadDocuments();
