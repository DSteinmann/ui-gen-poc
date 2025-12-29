
// Minimal text preprocessing for TF/IDF scoring.
export const tokenize = (text = '') =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

export const buildTermFrequency = (tokens = []) =>
  tokens.reduce((acc, token) => {
    acc[token] = (acc[token] || 0) + 1;
    return acc;
  }, {});

export const cosineSimilarity = (vectorA, vectorB) => {
  const uniqueTokens = new Set([...Object.keys(vectorA), ...Object.keys(vectorB)]);
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  uniqueTokens.forEach((token) => {
    const a = vectorA[token] || 0;
    const b = vectorB[token] || 0;
    dotProduct += a * b;
    magnitudeA += a * a;
    magnitudeB += b * b;
  });

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
};

// Quick-n-dirty TF/IDF scorer that pulls requirement snippets relevant to the current prompt/context bundle.
export const retrieveRelevantDocuments = (documents, { prompt, thingDescription, capabilityData, capabilities, missingCapabilities, device, uiContext, thingActions, availableThings }) => {
  if (!Array.isArray(documents) || documents.length === 0) return [];

  const querySegments = [];

  if (prompt) querySegments.push(prompt);
  if (thingDescription) {
    querySegments.push(
      typeof thingDescription === 'string' ? thingDescription : JSON.stringify(thingDescription)
    );
  }
  if (capabilityData && Object.keys(capabilityData).length > 0) {
    querySegments.push(JSON.stringify(capabilityData));
  }
  if (Array.isArray(capabilities) && capabilities.length > 0) {
    querySegments.push(`capabilities: ${capabilities.join(', ')}`);
  }
  if (Array.isArray(missingCapabilities) && missingCapabilities.length > 0) {
    querySegments.push(`missing: ${missingCapabilities.join(', ')}`);
  }
  if (device) {
    querySegments.push(JSON.stringify({ device }));
  }
  if (uiContext) {
    querySegments.push(JSON.stringify(uiContext));
  }
  if (Array.isArray(thingActions) && thingActions.length > 0) {
    querySegments.push(JSON.stringify({ thingActions }));
  }
  if (Array.isArray(availableThings) && availableThings.length > 0) {
    querySegments.push(JSON.stringify({ availableThings }));
  }

  const query = querySegments.filter(Boolean).join('\n');
  const queryTokens = tokenize(query);
  const queryVector = buildTermFrequency(queryTokens);

  if (Object.keys(queryVector).length === 0) {
    return [];
  }

  const scoredDocuments = documents
    .map((doc) => ({
      score: cosineSimilarity(queryVector, doc.termFrequency || {}),
      document: doc,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ score, document }) => ({
      ...document,
      score,
    }));

  return scoredDocuments;
};
