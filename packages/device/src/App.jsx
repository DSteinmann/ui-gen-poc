import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './App.css';

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
          'activity-recognition',
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

const resolveDeviceApiBase = () => {
  const envOverride = import.meta.env.VITE_DEVICE_API_URL;
  if (envOverride && typeof envOverride === 'string') {
    return envOverride.endsWith('/') ? envOverride.slice(0, -1) : envOverride;
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const host = window.location.hostname || 'localhost';
    const defaultPort = import.meta.env.VITE_DEVICE_API_PORT || '3002';
    return `${protocol}//${host}:${defaultPort}`;
  }

  return 'http://localhost:3002';
};

const deviceApiBase = resolveDeviceApiBase();

const actionStatusStyles = {
  pending: { background: '#F1F5FE', color: '#1f6feb' },
  success: { background: '#E6F4EA', color: '#0B8A37' },
  error: { background: '#FEECEC', color: '#C62828' },
};

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

const clampChannel = (value) => Math.max(0, Math.min(255, value));

const adjustHexColor = (hexColor, amount = 0) => {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) {
    return null;
  }

  const adjustment = Math.max(-255, Math.min(255, amount));
  const r = clampChannel(parseInt(normalized.slice(1, 3), 16) + adjustment);
  const g = clampChannel(parseInt(normalized.slice(3, 5), 16) + adjustment);
  const b = clampChannel(parseInt(normalized.slice(5, 7), 16) + adjustment);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const normalizeToken = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

const LARGE_PROFILE_ALIASES = new Set([
  'large',
  'large-tap-targets',
  'large tap targets',
  'large_tap_targets',
  'glove-mode',
  'spacious',
]);

const COMPACT_PROFILE_ALIASES = new Set([
  'compact',
  'dense',
  'one-handed',
  'one handed',
  'compact-mode',
]);

const componentSizePresets = {
  text: {
    compact: { fontSize: '13px', lineHeight: 1.35, margin: '4px 0' },
    standard: { fontSize: '16px', lineHeight: 1.5, margin: '8px 0' },
    large: { fontSize: '22px', lineHeight: 1.65, margin: '14px 0' },
  },
  button: {
    compact: { padding: '8px 12px', fontSize: '14px', borderRadius: '8px', minHeight: '38px' },
    standard: { padding: '12px 18px', fontSize: '16px', borderRadius: '10px', minHeight: '48px' },
    large: { padding: '20px 26px', fontSize: '20px', borderRadius: '14px', minHeight: '64px' },
  },
  toggle: {
    compact: { labelFontSize: '14px', controlSize: '16px', gap: '6px', paddingY: '4px' },
    standard: { labelFontSize: '16px', controlSize: '20px', gap: '10px', paddingY: '8px' },
    large: { labelFontSize: '20px', controlSize: '28px', gap: '14px', paddingY: '12px' },
  },
  slider: {
    compact: {
      blockSpacing: '10px',
      labelFontSize: '14px',
      valueFontSize: '13px',
      markerFontSize: '11px',
      trackHeight: '22px',
    },
    standard: {
      blockSpacing: '16px',
      labelFontSize: '16px',
      valueFontSize: '15px',
      markerFontSize: '13px',
      trackHeight: '30px',
    },
    large: {
      blockSpacing: '26px',
      labelFontSize: '20px',
      valueFontSize: '19px',
      markerFontSize: '16px',
      trackHeight: '44px',
    },
  },
  dropdown: {
    compact: {
      blockSpacing: '8px',
      labelFontSize: '14px',
      controlFontSize: '14px',
      padding: '8px 12px',
      minHeight: '36px',
      labelGap: '4px',
    },
    standard: {
      blockSpacing: '14px',
      labelFontSize: '16px',
      controlFontSize: '16px',
      padding: '12px 16px',
      minHeight: '48px',
      labelGap: '6px',
    },
    large: {
      blockSpacing: '24px',
      labelFontSize: '20px',
      controlFontSize: '20px',
      padding: '20px 22px',
      minHeight: '64px',
      labelGap: '10px',
    },
  },
};

const toNumericPixels = (value, fallback = 16) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace('px', ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

const toPixelString = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}px`;
  }

  if (typeof value === 'string' && value.trim().length) {
    return value;
  }

  return `${fallback}px`;
};

const resolveErgonomicsProfile = (context = {}) => {
  const candidate =
    context.ergonomicsProfile
    || context?.ergonomics?.profile
    || context?.ergonomicsMode
    || context?.ergonomicsPreset
    || context?.defaultErgonomicsProfile;

  return 'compact';
};

const normalizeSizeToken = (size) => {
  const token = normalizeToken(size);
  if (!token || token === 'auto') {
    return null;
  }

  if (token === 'comfortable' || token === 'spacious') {
    return 'large';
  }

  if (token === 'dense' || token === 'condensed') {
    return 'compact';
  }

  if (token === 'default') {
    return 'standard';
  }

  if (['compact', 'standard', 'large'].includes(token)) {
    return token;
  }

  return null;
};

const resolveComponentSize = (requestedSize, ergonomicsProfile) => {
  const explicitSize = normalizeSizeToken(requestedSize);
  if (explicitSize) {
    return explicitSize;
  }

  if (LARGE_PROFILE_ALIASES.has(ergonomicsProfile)) {
    return 'large';
  }

  if (COMPACT_PROFILE_ALIASES.has(ergonomicsProfile)) {
    return 'compact';
  }

  return 'standard';
};

const getSizingForComponent = (component, sizeToken) => {
  const preset = componentSizePresets[component];
  if (!preset) {
    return {};
  }

  return preset[sizeToken] || preset.standard || {};
};

const deriveThingIdFromAction = (action) => {
  if (!action || typeof action !== 'object') {
    return null;
  }

  if (action.thingId) {
    return action.thingId;
  }

  if (action.thing && typeof action.thing === 'object') {
    return action.thing.id || action.thing.thingId || null;
  }

  if (typeof action.id === 'string' && action.id.includes('::')) {
    const [thingId] = action.id.split('::');
    return thingId || null;
  }

  return null;
};

function App() {
  const [ui, setUi] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [actionState, setActionState] = useState({ status: null, message: null });
  const [controlValues, setControlValues] = useState({});

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
  const accentHighlight = useMemo(() => adjustHexColor(primaryColor, 35) || primaryColor, [primaryColor]);
  const accentShadow = useMemo(() => adjustHexColor(primaryColor, -30) || primaryColor, [primaryColor]);
  const glassOverlay = useMemo(() => rgbaFromHex(primaryColor, 0.08), [primaryColor]);
  const subtleBorder = useMemo(() => rgbaFromHex(primaryColor, 0.18), [primaryColor]);
  const ergonomicsProfile = useMemo(() => resolveErgonomicsProfile(ui?.context || {}), [ui]);

  useEffect(() => {
    if (!actionState.status || actionState.status === 'pending') {
      return undefined;
    }

    const timeout = setTimeout(() => {
      setActionState({ status: null, message: null });
    }, 4000);

    return () => clearTimeout(timeout);
  }, [actionState]);

  const executeAction = useCallback(async (actionPayload, metadata = {}) => {
    if (!actionPayload) {
      setActionState({ status: 'error', message: 'No action metadata provided.' });
      return;
    }

    setActionState({ status: 'pending', message: 'Sending action…' });

    try {
      const inferredThingId = metadata.thingId || deriveThingIdFromAction(actionPayload) || ui?.context?.thingId || ui?.thingId || null;
      const response = await fetch(`${deviceApiBase}/api/execute-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionPayload,
          context: {
            deviceId,
            component: metadata.component,
            label: metadata.label,
            value: metadata.value,
            thingId: inferredThingId,
            timestamp: new Date().toISOString(),
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Device rejected the action request.');
      }

      setActionState({
        status: 'success',
        message: data?.message || 'Action executed successfully.',
      });
    } catch (error) {
      setActionState({ status: 'error', message: error.message || 'Failed to execute action.' });
    }
  }, []);

  const resolveControlKey = useCallback((componentType, props = {}) => {
    return (
      props.id
      || props.name
      || props.label
      || props.title
      || props.placeholder
      || props.action?.id
      || props.action?.name
      || `${componentType}-${props.componentId || 'default'}`
    );
  }, []);

  const updateControlValue = useCallback((key, value) => {
    setControlValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

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
    const children = props.children || props.components || element.children;
    const normalizedChildren = Array.isArray(children)
      ? children
      : children
        ? [children]
        : [];

    if (!type) {
      return null;
    }

    switch (type) {
      case 'container': {
        const layoutToken = normalizeToken(props.layout) || 'column';
        const isGrid = ['grid', 'tiles', 'masonry'].includes(layoutToken);
        const isRow = ['row', 'horizontal'].includes(layoutToken);
        const surfaceVariant = normalizeToken(props.variant) || 'panel';
        const surfaceBackground =
          surfaceVariant === 'ghost'
            ? 'transparent'
            : surfaceVariant === 'emphasis'
              ? `linear-gradient(140deg, ${rgbaFromHex(primaryColor, 0.18)}, ${rgbaFromHex(primaryColor, 0.05)})`
              : `linear-gradient(145deg, rgba(255, 255, 255, 0.98), ${rgbaFromHex(primaryColor, 0.04)})`;

        const containerStyle = {
          border: `1px solid ${subtleBorder}`,
          padding: '20px',
          margin: '12px 0',
          borderRadius: '20px',
          background: surfaceBackground,
          boxShadow:
            surfaceVariant === 'ghost'
              ? `inset 0 0 0 1px ${rgbaFromHex(primaryColor, 0.08)}`
              : '0 18px 30px rgba(15, 23, 42, 0.08)',
          display: isGrid ? 'grid' : 'flex',
          flexDirection: isGrid ? undefined : isRow ? 'row' : 'column',
          flexWrap: isRow ? 'wrap' : 'nowrap',
          gap: '16px',
          gridTemplateColumns: isGrid ? 'repeat(auto-fit, minmax(180px, 1fr))' : undefined,
          backdropFilter: surfaceVariant === 'ghost' ? 'blur(6px)' : 'blur(2px)',
          position: 'relative',
          overflow: 'hidden',
        };

        return (
          <div style={containerStyle}>
            {surfaceVariant !== 'ghost' && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: '-40% auto auto 40%',
                  width: '120px',
                  height: '120px',
                  background: glassOverlay,
                  filter: 'blur(60px)',
                  borderRadius: '50%',
                  opacity: 0.5,
                  pointerEvents: 'none',
                }}
              />
            )}
            {normalizedChildren.map((child, index) => (
              <React.Fragment key={index}>{renderUi(child)}</React.Fragment>
            ))}
          </div>
        );
      }
      case 'text':
        {
          const sizeToken = resolveComponentSize(props.size, ergonomicsProfile);
          const textSizing = getSizingForComponent('text', sizeToken);
          return (
            <p
              style={{
                margin: textSizing.margin || '8px 0',
                fontSize: textSizing.fontSize || '16px',
                lineHeight: textSizing.lineHeight || 1.5,
                color: props.tone === 'muted' ? '#6b7280' : '#0f172a',
                fontWeight: props.variant === 'subtitle' ? 600 : 400,
              }}
            >
              {props.content || props.text}
            </p>
          );
        }
      case 'button':
        {
          const sizeToken = resolveComponentSize(props.size, ergonomicsProfile);
          const buttonSizing = getSizingForComponent('button', sizeToken);
          const emphasis = normalizeToken(props.style) || 'solid';
          const isGhost = emphasis === 'ghost';
          const isOutline = emphasis === 'outline';
          const disabled = Boolean(props.disabled);
          const hasAction = Boolean(props.action);
          const gradientFill = `linear-gradient(130deg, ${accentHighlight}, ${accentShadow})`;
          const background = isGhost || isOutline ? 'transparent' : gradientFill;
          const borderColor = isGhost ? rgbaFromHex(primaryColor, 0.2) : rgbaFromHex(primaryColor, 0.35);
          const textColor = disabled ? '#9ca3af' : isGhost || isOutline ? accentShadow : primaryContrast;

          const handleClick = () => {
            if (disabled) {
              return;
            }

            if (!hasAction) {
              setActionState({ status: 'error', message: 'This button is missing an action binding.' });
              return;
            }

            executeAction(props.action, {
              component: 'button',
              label: props.label || props.content || props.text,
              thingId: props.action?.thingId,
            });
          };

          return (
            <button
              type="button"
              disabled={disabled}
              style={{
                background,
                color: textColor,
                border: `1px solid ${disabled ? '#e5e7eb' : borderColor}`,
                borderRadius: buttonSizing.borderRadius || '12px',
                padding: buttonSizing.padding || '12px 18px',
                fontSize: buttonSizing.fontSize || '16px',
                fontWeight: 600,
                cursor: disabled ? 'not-allowed' : hasAction ? 'pointer' : 'help',
                margin: '6px 0',
                minHeight: buttonSizing.minHeight || '48px',
                width: props.fullWidth ? '100%' : 'auto',
                boxShadow: disabled ? 'none' : `0 18px 32px ${rgbaFromHex(primaryColor, 0.3)}`,
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                transform: disabled ? 'none' : 'translateY(0)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                backdropFilter: isGhost ? 'blur(6px)' : 'initial',
                letterSpacing: '0.02em',
              }}
              onClick={handleClick}
            >
              {props.icon && <span aria-hidden="true">{props.icon}</span>}
              <span>{props.label || props.content || props.text}</span>
            </button>
          );
        }
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
      case 'toggle': {
        const sizeToken = resolveComponentSize(props.size, ergonomicsProfile);
        const toggleSizing = getSizingForComponent('toggle', sizeToken);
        const controlSize = toNumericPixels(toggleSizing.controlSize, 20);
        const trackWidth = `${controlSize * 2}px`;
        const knobSize = `${controlSize - 4}px`;
        const isChecked = typeof props.checked === 'boolean' ? props.checked : false;
        const inputId = resolveControlKey('toggle', props);

        return (
          <label
            htmlFor={inputId}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: toggleSizing.gap || '12px',
              padding: `${toggleSizing.paddingY || '10px'} 0`,
              fontSize: toggleSizing.labelFontSize || '16px',
              fontWeight: 500,
            }}
          >
            <span style={{ flex: '1 1 auto', color: '#1f2933' }}>{props.label}</span>
            <span
              style={{
                position: 'relative',
                width: trackWidth,
                height: toPixelString(controlSize, 20),
                background: isChecked
                  ? `linear-gradient(120deg, ${accentHighlight}, ${accentShadow})`
                  : 'rgba(148, 163, 184, 0.4)',
                borderRadius: '999px',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: isChecked ? 'flex-end' : 'flex-start',
                boxShadow: isChecked
                  ? `0 6px 18px ${rgbaFromHex(primaryColor, 0.45)}`
                  : 'inset 0 1px 4px rgba(15, 23, 42, 0.12)',
                transition: 'background 0.2s ease',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: knobSize,
                  height: knobSize,
                  borderRadius: '999px',
                  background: '#ffffff',
                  boxShadow: '0 2px 6px rgba(15, 23, 42, 0.2)',
                  transition: 'transform 0.2s ease',
                  transform: 'translateX(0)',
                }}
              />
            </span>
            <input
              id={inputId}
              type="checkbox"
              checked={isChecked}
              onChange={(event) => {
                if (!props.action) return;
                const nextValue = event.target.checked;
                executeAction(props.action, {
                  component: 'toggle',
                  label: props.label,
                  value: nextValue,
                  thingId: props.action?.thingId,
                });
              }}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
            />
          </label>
        );
      }
      case 'slider': {
        const key = resolveControlKey('slider', props);
        const min = typeof props.min === 'number' ? props.min : 0;
        const max = typeof props.max === 'number' ? props.max : 100;
        const step = typeof props.step === 'number' ? props.step : 1;
        const defaultValue = typeof props.value === 'number' ? props.value : min;
        const currentValue =
          Object.prototype.hasOwnProperty.call(controlValues, key) ? controlValues[key] : defaultValue;
        const unitSuffix = props.unit ? ` ${props.unit}` : '';
        const sendMode = props.trigger === 'change' ? 'change' : 'commit';
        const sizeToken = resolveComponentSize(props.size, ergonomicsProfile);
        const sliderSizing = getSizingForComponent('slider', sizeToken);
        const progress = ((currentValue - min) / (max - min || 1)) * 100;
        const trackFill = `linear-gradient(90deg, ${accentHighlight} ${progress}%, rgba(148, 163, 184, 0.35) ${progress}%)`;

        const commitValue = (value) => {
          if (!props.action) {
            return;
          }

          executeAction(props.action, {
            component: 'slider',
            label: props.label,
            value,
            thingId: props.action?.thingId,
          });
        };

        return (
          <div style={{ margin: `${sliderSizing.blockSpacing || '20px'} 0` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontWeight: 600, fontSize: sliderSizing.labelFontSize || '16px', color: '#0f172a' }}>{props.label}</span>
              <span style={{ color: '#4d4f54', fontSize: sliderSizing.valueFontSize || '15px' }}>
                {currentValue}
                {unitSuffix}
              </span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={currentValue}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                updateControlValue(key, nextValue);
                if (sendMode === 'change') {
                  commitValue(nextValue);
                }
              }}
              onMouseUp={(event) => {
                if (sendMode === 'commit') {
                  commitValue(Number(event.target.value));
                }
              }}
              onTouchEnd={(event) => {
                if (sendMode === 'commit') {
                  commitValue(Number(event.target.value));
                }
              }}
              style={{
                width: '100%',
                height: sliderSizing.trackHeight || '30px',
                accentColor: primaryColor,
                cursor: 'pointer',
                background: trackFill,
                borderRadius: '999px',
                border: `1px solid ${rgbaFromHex(primaryColor, 0.22)}`,
                boxShadow: 'inset 0 1px 3px rgba(15, 23, 42, 0.15)',
              }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: sliderSizing.markerFontSize || '13px',
                color: '#6c6f75',
                marginTop: '6px',
              }}
            >
              <span>
                {min}
                {unitSuffix}
              </span>
              <span>
                {max}
                {unitSuffix}
              </span>
            </div>
          </div>
        );
      }
      case 'dropdown': {
        const key = resolveControlKey('dropdown', props);
        const options = Array.isArray(props.options) ? props.options : [];
        const defaultValue = props.value ?? options[0]?.value ?? '';
        const currentValue =
          Object.prototype.hasOwnProperty.call(controlValues, key) ? controlValues[key] : defaultValue;

        return (
          <label style={{ display: 'block', margin: '18px 0' }}>
            <span style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#0f172a' }}>{props.label}</span>
            <select
              value={currentValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                updateControlValue(key, nextValue);
                if (props.action) {
                  executeAction(props.action, {
                    component: 'dropdown',
                    label: props.label,
                    value: nextValue,
                    thingId: props.action?.thingId,
                  });
                }
              }}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '14px',
                border: `1px solid ${subtleBorder}`,
                background: `linear-gradient(140deg, rgba(255, 255, 255, 0.95), ${rgbaFromHex(primaryColor, 0.06)})`,
                boxShadow: '0 12px 28px rgba(15, 23, 42, 0.09)',
                fontSize: '15px',
                fontWeight: 500,
                color: '#1f2933',
              }}
            >
              {props.placeholder && (
                <option value="" disabled={Boolean(defaultValue)}>
                  {props.placeholder}
                </option>
              )}
              {options.map((option) => (
                <option key={option.value || option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        );
      }
      case 'statusCard': {
        const tone = props.tone || 'info';
        const palette = {
          info: {
            background: `linear-gradient(145deg, ${rgbaFromHex(primaryColor, 0.16)}, rgba(255, 255, 255, 0.9))`,
            text: accentShadow,
          },
          success: { background: 'linear-gradient(145deg, #d1fae5, #ffffff)', text: '#15803d' },
          warning: { background: 'linear-gradient(145deg, #fff7ed, #ffffff)', text: '#b45309' },
          danger: { background: 'linear-gradient(145deg, #fee2e2, #ffffff)', text: '#b91c1c' },
        };
        const resolved = palette[tone] || palette.info;
        const items = Array.isArray(props.items) ? props.items : [];

        return (
          <div
            style={{
              background: resolved.background,
              borderRadius: '20px',
              padding: '20px',
              margin: '14px 0',
              color: resolved.text,
              border: `1px solid ${rgbaFromHex(primaryColor, 0.1)}`,
              boxShadow: '0 20px 36px rgba(15, 23, 42, 0.08)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 'auto -20% -60% auto',
                width: '180px',
                height: '180px',
                background: rgbaFromHex(primaryColor, 0.12),
                filter: 'blur(60px)',
                borderRadius: '50%',
                pointerEvents: 'none',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              {props.icon && <span style={{ fontSize: '20px' }}>{props.icon}</span>}
              <span style={{ fontWeight: 700, color: '#111827' }}>{props.title}</span>
            </div>
            {props.value && (
              <div style={{ fontSize: '32px', fontWeight: 800, color: resolved.text }}>{props.value}</div>
            )}
            {items.length > 0 && (
              <div style={{ marginTop: '16px', display: 'grid', gap: '8px' }}>
                {items.map((item, index) => (
                  <div
                    key={`${item.label}-${index}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      color: '#1f2937',
                      fontSize: '15px',
                    }}
                  >
                    <span>{item.label}</span>
                    <span style={{ fontWeight: 600 }}>{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div
      className="app-shell"
      style={{
        '--primary-color': primaryColor,
        '--primary-contrast': primaryContrast,
      }}
    >
      <div className="ui-wrapper">
        <div className="ui-card">
          <header className="ui-header">
            <h1 className="ui-heading">Smartphone Controller</h1>
            <div className="ui-subheading">Listening for UI updates…</div>
            {lastUpdate && (
              <div className="last-update">Last update: {new Date(lastUpdate).toLocaleTimeString()}</div>
            )}
            <div className="ergonomics-label">
              Ergonomics profile: <strong>{ergonomicsProfile}</strong>
            </div>
            {actionState.status && (
              <div
                className="status-pill"
                style={{
                  background: actionStatusStyles[actionState.status]?.background,
                  color: actionStatusStyles[actionState.status]?.color,
                }}
              >
                {actionState.message}
              </div>
            )}
          </header>
          <section className="ui-body">
            {ui ? renderUi(ui) : <div className="empty-state">Waiting for the core system to send a layout…</div>}
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;