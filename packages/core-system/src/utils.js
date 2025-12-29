export const nowIsoString = () => new Date().toISOString();

export const normalizeUrl = (url) => {
  if (!url) return url;
  return url.endsWith('/') ? url.slice(0, -1) : url;
};

export const composeUrl = (base, path = '/') => {
  if (!path || path === '/') return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};
