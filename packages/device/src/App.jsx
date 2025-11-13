import React, { useState, useEffect, useMemo } from 'react';

const deviceId = 'device-smartphone-001';

const appendDeviceId = (baseUrl) => {
  const suffix = `deviceId=${encodeURIComponent(deviceId)}`;
  if (!baseUrl.includes('?')) {
    return `${baseUrl}?${suffix}`;
  }

  const hasTrailingQuestion = baseUrl.endsWith('?');
  const separator = hasTrailingQuestion || baseUrl.endsWith('&') ? '' : '&';
  return `${baseUrl}${separator}${suffix}`;
};

const resolveWebsocketUrl = () => {
  const envUrl = import.meta.env.VITE_CORE_WS_URL;

  if (envUrl && typeof envUrl === 'string') {
    if (typeof window !== 'undefined') {
      try {
        const parsed = new URL(envUrl);
        const browserHost = window.location.hostname || 'localhost';
        const dockerOnlyHosts = new Set([
          'core-system',
          'capability-system',
          'knowledge-base',
          'device-api',
          'device-ui',
          '0.0.0.0',
        ]);

        if (dockerOnlyHosts.has(parsed.hostname)) {
          parsed.hostname = browserHost;
        }

        parsed.searchParams.set('deviceId', deviceId);
        return parsed.toString();
      } catch (error) {
        console.warn('Failed to parse VITE_CORE_WS_URL, falling back to heuristics.', error);
        return appendDeviceId(envUrl.endsWith('/') ? envUrl.slice(0, -1) : envUrl);
      }
    }

    return appendDeviceId(envUrl.endsWith('/') ? envUrl.slice(0, -1) : envUrl);
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const defaultCorePort = import.meta.env.VITE_CORE_WS_FALLBACK_PORT || '3001';
    return `${protocol}//${host}:${defaultCorePort}?deviceId=${encodeURIComponent(deviceId)}`;
  }

  return `ws://localhost:3001?deviceId=${encodeURIComponent(deviceId)}`;
};

const websocketUrl = resolveWebsocketUrl();

const DEFAULT_PRIMARY_COLOR = '#1f6feb';

const normalizeHexColor = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  if (!hexMatch.test(trimmed)) {
    return null;
  }

  if (trimmed.length === 4) {
    const [hash, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return trimmed.toLowerCase();
};

const getContrastColor = (hexColor) => {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) {
    return '#ffffff';
  }

  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111111' : '#ffffff';
};

const rgbaFromHex = (hexColor, alpha = 0.15) => {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function App() {
  const [ui, setUi] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    const ws = new WebSocket(websocketUrl);

    ws.onopen = () => {
      console.log('Connected to UI Generator');
    };

    ws.onmessage = (event) => {
      console.log('Received UI definition:', event.data);
      try {
        const payload = JSON.parse(event.data);
        const messageUi = payload && payload.ui ? payload.ui : payload;
        setUi(messageUi);
        setLastUpdate(payload.generatedAt || new Date().toISOString());
      } catch (error) {
        console.error('Error parsing UI definition:', error);
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from UI Generator');
    };

    return () => {
      ws.close();
    };
  }, []);

  const theme = ui?.theme || {};
  const primaryColor = useMemo(
    () => normalizeHexColor(theme.primaryColor) || DEFAULT_PRIMARY_COLOR,
    [theme.primaryColor]
  );
  const primaryContrast = useMemo(() => getContrastColor(primaryColor), [primaryColor]);

  const renderUi = (element) => {
    if (!element) {
      return null;
    }

    if (element.props && element.props.children) {
      return renderUi(element.props.children);
    }

    if (Array.isArray(element)) {
      return element.map((child, index) => (
        <React.Fragment key={index}>{renderUi(child)}</React.Fragment>
      ));
    }
    
    if (element.components) {
      return renderUi(element.components);
    }

    const type = element.component || element.type;
    const props = element.props || element;

    if (!type) {
      return null;
    }

    switch (type) {
      case 'container':
        return (
          <div
            style={{
              border: `1px solid ${rgbaFromHex(primaryColor, 0.35)}`,
              padding: '16px',
              margin: '12px 0',
              borderRadius: '12px',
              background: rgbaFromHex(primaryColor, 0.08),
            }}
          >
            {Array.isArray(props.children) && props.children.map((child, index) => (
              <React.Fragment key={index}>{renderUi(child)}</React.Fragment>
            ))}
          </div>
        );
      case 'text':
        return <p style={{ margin: '8px 0', fontSize: '16px' }}>{props.content}</p>;
      case 'button':
        return (
          <button
            style={{
              backgroundColor: primaryColor,
              color: primaryContrast,
              border: `1px solid ${primaryColor}`,
              borderRadius: '8px',
              padding: '12px 16px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: props.action ? 'pointer' : 'default',
              margin: '6px 0',
            }}
            onClick={props.action ? () => alert(JSON.stringify(props.action)) : null}
          >
            {props.label || props.content}
          </button>
        );
      case 'input':
        return (
          <input
            type={props.type || 'text'}
            placeholder={props.placeholder}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              border: `1px solid ${rgbaFromHex(primaryColor, 0.45)}`,
              margin: '6px 0',
            }}
          />
        );
      case 'toggle':
        return (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 0',
            }}
          >
            <input
              type="checkbox"
              checked={props.checked}
              onChange={props.action ? () => alert(JSON.stringify(props.action)) : null}
              style={{ accentColor: primaryColor, width: '18px', height: '18px' }}
            />
            {props.label}
          </label>
        );
      default:
        return null;
    }
  };

  return (
    <div
      style={{
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        backgroundColor: '#f4f5f7',
        minHeight: '100vh',
      }}
    >
      <div style={{ maxWidth: '420px', margin: '0 auto', padding: '24px 20px' }}>
        <header style={{ marginBottom: '16px' }}>
          <h1 style={{ margin: 0, color: primaryColor }}>End Device</h1>
          <div style={{ marginTop: '6px', color: '#4d4f54' }}>Listening for UI updates…</div>
          {lastUpdate && (
            <div style={{ marginTop: '4px', color: '#6c6f75', fontSize: '14px' }}>
              Last update: {new Date(lastUpdate).toLocaleTimeString()}
            </div>
          )}
        </header>
        {renderUi(ui)}
      </div>
    </div>
  );
}

export default App;