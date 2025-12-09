import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './App.css';

const deviceId = 'device-tablet-001';
const GRID_COLUMNS = 12;
const DEFAULT_PRIMARY_COLOR = '#2563eb';
const DEFAULT_CELL_SPAN = 6;

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
          'tablet-device-api',
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
    const defaultPort = import.meta.env.VITE_DEVICE_API_PORT || '3012';
    return `${protocol}//${host}:${defaultPort}`;
  }

  return 'http://localhost:3012';
};

const deviceApiBase = resolveDeviceApiBase();

const actionStatusStyles = {
  pending: { background: '#E0EDFF', color: '#1d4ed8' },
  success: { background: '#DCFCE7', color: '#15803d' },
  error: { background: '#FEE2E2', color: '#b91c1c' },
};

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
  return luminance > 0.6 ? '#0f172a' : '#ffffff';
};

const rgbaFromHex = (hexColor, alpha = 0.2) => {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) {
    return `rgba(15, 23, 42, ${alpha})`;
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
  'cozy-desktop',
  'spacious',
]);

const COMPACT_PROFILE_ALIASES = new Set([
  'compact',
  'dense',
  'information-dense',
  'info-dense',
]);

const componentSizePresets = {
  text: {
    compact: { fontSize: '14px', lineHeight: 1.4, margin: '6px 0' },
    standard: { fontSize: '18px', lineHeight: 1.6, margin: '10px 0' },
    large: { fontSize: '24px', lineHeight: 1.7, margin: '14px 0' },
  },
  button: {
    compact: { padding: '10px 16px', fontSize: '15px', borderRadius: '10px', minHeight: '44px' },
    standard: { padding: '16px 22px', fontSize: '17px', borderRadius: '12px', minHeight: '56px' },
    large: { padding: '22px 28px', fontSize: '20px', borderRadius: '14px', minHeight: '68px' },
  },
  toggle: {
    compact: { labelFontSize: '15px', controlSize: '18px', gap: '8px', paddingY: '6px' },
    standard: { labelFontSize: '18px', controlSize: '24px', gap: '12px', paddingY: '10px' },
    large: { labelFontSize: '22px', controlSize: '30px', gap: '16px', paddingY: '14px' },
  },
  slider: {
    compact: {
      blockSpacing: '12px',
      labelFontSize: '16px',
      valueFontSize: '15px',
      trackHeight: '24px',
      markerFontSize: '12px',
    },
    standard: {
      blockSpacing: '20px',
      labelFontSize: '18px',
      valueFontSize: '17px',
      trackHeight: '30px',
      markerFontSize: '14px',
    },
    large: {
      blockSpacing: '28px',
      labelFontSize: '22px',
      valueFontSize: '20px',
      trackHeight: '40px',
      markerFontSize: '16px',
    },
  },
  dropdown: {
    compact: {
      blockSpacing: '10px',
      labelFontSize: '15px',
      controlFontSize: '15px',
      padding: '10px 14px',
      minHeight: '42px',
      labelGap: '4px',
    },
    standard: {
      blockSpacing: '18px',
      labelFontSize: '17px',
      controlFontSize: '17px',
      padding: '14px 18px',
      minHeight: '52px',
      labelGap: '6px',
    },
    large: {
      blockSpacing: '26px',
      labelFontSize: '21px',
      controlFontSize: '21px',
      padding: '20px 22px',
      minHeight: '66px',
      labelGap: '8px',
    },
  },
};

const regionPresets = {
  hero: { column: 1, colSpan: 12, rowSpan: 2 },
  overview: { column: 1, colSpan: 8 },
  controls: { column: 5, colSpan: 8 },
  sidebar: { column: 9, colSpan: 4 },
  stats: { column: 1, colSpan: 4 },
  telemetry: { column: 9, colSpan: 4 },
};

const alignMap = {
  start: 'start',
  end: 'end',
  center: 'center',
  stretch: 'stretch',
};

const toNumericPixels = (value, fallback = 16) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace('px', ''));
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
    || context?.defaultErgonomicsProfile
    || context?.profile;

  const token = normalizeToken(candidate);
  if (!token) {
    return 'standard';
  }

  if (LARGE_PROFILE_ALIASES.has(token)) {
    return 'large';
  }

  if (COMPACT_PROFILE_ALIASES.has(token)) {
    return 'compact';
  }

  return token;
};

const normalizeSizeToken = (size) => {
  const token = normalizeToken(size);
  if (!token || token === 'auto') {
    return null;
  }

  if (token === 'comfortable' || token === 'cozy-desktop') {
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

  if (ergonomicsProfile === 'large') {
    return 'large';
  }

  if (ergonomicsProfile === 'compact') {
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

const clampInt = (value, min, max) => {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (max !== undefined) {
    return Math.max(min, Math.min(max, parsed));
  }
  return Math.max(min, parsed);
};

const mergePlacementConfig = (placement = {}) => {
  if (!placement || typeof placement !== 'object') {
    return null;
  }

  const preset = placement.region ? regionPresets[normalizeToken(placement.region)] : null;
  return { ...(preset || {}), ...placement };
};

const componentPlacementDefaults = {
  container: { span: 12 },
  text: { span: 8 },
  statuscard: { span: 4 },
  button: { span: 4 },
  toggle: { span: 4 },
  slider: { span: 6 },
  dropdown: { span: 6 },
  toolcall: { span: 6 },
};

const inferPlacementForComponent = (componentType, componentProps = {}) => {
  if (!componentType) {
    return null;
  }

  const normalizedType = normalizeToken(componentType);
  if (!normalizedType) {
    return null;
  }

  const regionHint = normalizeToken(
    componentProps.region
    || componentProps.zone
    || componentProps.section
    || componentProps.area
  );

  if (regionHint && regionPresets[regionHint]) {
    return { ...regionPresets[regionHint] };
  }

  if (normalizedType === 'text') {
    const variant = normalizeToken(componentProps.variant);
    if (variant === 'eyebrow' || variant === 'label') {
      return { span: 12, minHeight: 'auto' };
    }

    if (variant === 'hero' || variant === 'title') {
      return { region: 'hero', rowSpan: 2 };
    }

    if (variant === 'subtitle') {
      return { span: 6 };
    }
  }

  if (normalizedType === 'button') {
    if (componentProps.fullWidth) {
      return { span: 12, minHeight: 'auto' };
    }

    if (normalizeToken(componentProps.style) === 'secondary') {
      return { span: 5 };
    }

    return { span: 4, minHeight: 'auto' };
  }

  if (normalizedType === 'toggle') {
    return { span: 4, minHeight: 'auto' };
  }

  if (normalizedType === 'slider' || normalizedType === 'dropdown') {
    return { span: 6 };
  }

  if (normalizedType === 'statuscard') {
    const itemCount = Array.isArray(componentProps.items) ? componentProps.items.length : 0;
    const needsBreathingRoom = itemCount > 2 || (componentProps.value ? componentProps.value.length > 6 : false);
    return { span: needsBreathingRoom ? 6 : 4 };
  }

  if (normalizedType === 'container') {
    const variant = normalizeToken(componentProps.variant);
    if (variant === 'sidebar') {
      return { region: 'sidebar' };
    }

    if (variant === 'hero' || variant === 'emphasis') {
      return { region: 'overview', span: 8 };
    }

    return { span: 12 };
  }

  const fallback = componentPlacementDefaults[normalizedType];
  return fallback ? { ...fallback } : null;
};

const derivePlacementStyle = (placement) => {
  if (!placement || typeof placement !== 'object') {
    return {
      gridColumn: `span ${DEFAULT_CELL_SPAN}`,
    };
  }

  const config = mergePlacementConfig(placement);
  const columnStart = clampInt(config.column ?? config.col ?? config.x, 1, GRID_COLUMNS);
  const columnSpan = clampInt(config.colSpan ?? config.span ?? config.width, 1, GRID_COLUMNS);
  const rowStart = clampInt(config.row ?? config.y, 1, 200);
  const rowSpan = clampInt(config.rowSpan ?? config.height, 1, 200);
  const style = {};

  if (columnStart && columnSpan) {
    style.gridColumn = `${columnStart} / span ${columnSpan}`;
  } else if (columnStart) {
    const remaining = GRID_COLUMNS - columnStart + 1;
    const span = columnSpan || Math.min(DEFAULT_CELL_SPAN, remaining);
    style.gridColumn = `${columnStart} / span ${Math.max(1, span)}`;
  } else if (columnSpan) {
    style.gridColumn = `span ${columnSpan}`;
  } else {
    style.gridColumn = `span ${DEFAULT_CELL_SPAN}`;
  }

  if (rowStart && rowSpan) {
    style.gridRow = `${rowStart} / span ${rowSpan}`;
  } else if (rowSpan) {
    style.gridRow = `span ${rowSpan}`;
  } else if (rowStart) {
    style.gridRow = `${rowStart} / span 1`;
  }

  if (config.minHeight) {
    style.minHeight = typeof config.minHeight === 'number' ? `${config.minHeight}px` : config.minHeight;
  }

  if (config.maxHeight) {
    style.maxHeight = typeof config.maxHeight === 'number' ? `${config.maxHeight}px` : config.maxHeight;
  }

  if (config.order !== undefined && config.order !== null) {
    const order = Number.parseInt(config.order, 10);
    if (Number.isFinite(order)) {
      style.order = order;
    }
  }

  if (config.align) {
    style.alignSelf = alignMap[normalizeToken(config.align)] || config.align;
  }

  if (config.justify) {
    style.justifySelf = alignMap[normalizeToken(config.justify)] || config.justify;
  }

  if (config.layer === 'overlay') {
    style.zIndex = 3;
  }

  return style;
};

const extractPlacement = (elementProps = {}, element = {}) => {
  if (!elementProps && !element) {
    return null;
  }

  const direct = typeof elementProps.placement === 'object' ? elementProps.placement : null;
  const position = typeof elementProps.position === 'object' ? elementProps.position : null;
  const layoutObj = typeof elementProps.layout === 'object' ? elementProps.layout : null;
  const legacyPlacement = typeof element?.placement === 'object' ? element.placement : null;
  return direct || position || layoutObj || legacyPlacement || null;
};

const wrapWithPlacement = (child, placement) => {
  if (!child) {
    return null;
  }

  const style = derivePlacementStyle(placement);
  const classNames = ['tablet-cell'];
  if (placement?.layer === 'overlay') {
    classNames.push('tablet-cell--overlay');
  }

  return (
    <div className={classNames.join(' ')} style={style}>
      {child}
    </div>
  );
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
  const accentHighlight = useMemo(() => adjustHexColor(primaryColor, 40) || primaryColor, [primaryColor]);
  const accentShadow = useMemo(() => adjustHexColor(primaryColor, -35) || primaryColor, [primaryColor]);
  const glassOverlay = useMemo(() => rgbaFromHex(theme.surfaceTint || primaryColor, 0.08), [theme.surfaceTint, primaryColor]);
  const subtleBorder = useMemo(() => rgbaFromHex(primaryColor, 0.18), [primaryColor]);
  const ergonomicsProfile = useMemo(() => resolveErgonomicsProfile(ui?.context || {}), [ui]);

  useEffect(() => {
    if (!actionState.status || actionState.status === 'pending') {
      return undefined;
    }

    const timeout = setTimeout(() => {
      setActionState({ status: null, message: null });
    }, 3500);

    return () => clearTimeout(timeout);
  }, [actionState]);

  const executeAction = useCallback(async (actionPayload, metadata = {}) => {
    if (!actionPayload) {
      setActionState({ status: 'error', message: 'No action metadata provided.' });
      return;
    }

    setActionState({ status: 'pending', message: 'Dispatching action…' });

    try {
      const inferredThingId =
        metadata.thingId
        || deriveThingIdFromAction(actionPayload)
        || ui?.context?.thingId
        || ui?.thingId
        || null;
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
  }, [ui]);

  const resolveControlKey = useCallback((componentType, props = {}) => (
    props.id
    || props.name
    || props.label
    || props.title
    || props.placeholder
    || props.action?.id
    || props.action?.name
    || `${componentType}-${props.componentId || 'default'}`
  ), []);

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

    const explicitPlacement = extractPlacement(props, element);
    const placement = explicitPlacement || inferPlacementForComponent(type, props);

    switch (type) {
      case 'container': {
        const layoutToken = typeof props.layout === 'string' ? normalizeToken(props.layout) : null;
        const isGrid = ['grid', 'tiles', 'masonry'].includes(layoutToken);
        const isRow = ['row', 'horizontal'].includes(layoutToken);
        const surfaceVariant = normalizeToken(props.variant) || 'panel';
        const surfaceBackground =
          surfaceVariant === 'ghost'
            ? 'transparent'
            : surfaceVariant === 'emphasis'
              ? `linear-gradient(135deg, ${rgbaFromHex(primaryColor, 0.18)}, rgba(255, 255, 255, 0.92))`
              : `linear-gradient(120deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85))`;

        const containerStyle = {
          border: surfaceVariant === 'ghost' ? `1px dashed ${subtleBorder}` : `1px solid ${rgbaFromHex(primaryColor, 0.12)}`,
          padding: '24px',
          borderRadius: '24px',
          background: surfaceBackground,
          boxShadow:
            surfaceVariant === 'ghost'
              ? 'none'
              : '0 35px 65px rgba(15, 23, 42, 0.14)',
          display: isGrid ? 'grid' : 'flex',
          flexDirection: isGrid ? undefined : isRow ? 'row' : 'column',
          flexWrap: isRow ? 'wrap' : 'nowrap',
          gap: '18px',
          gridTemplateColumns: isGrid ? 'repeat(auto-fit, minmax(240px, 1fr))' : undefined,
          position: 'relative',
          overflow: 'hidden',
          backdropFilter: 'blur(16px)',
        };

        const content = (
          <div className="tablet-container" style={containerStyle}>
            {surfaceVariant !== 'ghost' && (
              <span
                aria-hidden="true"
                className="tablet-container-glow"
                style={{ background: glassOverlay }}
              />
            )}
            {normalizedChildren.map((child, index) => (
              <React.Fragment key={index}>{renderUi(child)}</React.Fragment>
            ))}
          </div>
        );

        return wrapWithPlacement(content, placement);
      }
      case 'text': {
        const sizeToken = resolveComponentSize(props.size, ergonomicsProfile);
        const textSizing = getSizingForComponent('text', sizeToken);
        const content = (
          <p
            style={{
              margin: textSizing.margin || '10px 0',
              fontSize: textSizing.fontSize || '18px',
              lineHeight: textSizing.lineHeight || 1.6,
              color: props.tone === 'muted' ? '#64748b' : '#0f172a',
              fontWeight: props.variant === 'subtitle' ? 600 : props.variant === 'eyebrow' ? 500 : 400,
              letterSpacing: props.variant === 'eyebrow' ? '0.08em' : 'normal',
              textTransform: props.variant === 'eyebrow' ? 'uppercase' : 'none',
            }}
          >
            {props.content || props.text}
          </p>
        );
        return wrapWithPlacement(content, placement);
      }
      case 'button': {
        const sizeToken = resolveComponentSize(props.size, ergonomicsProfile);
        const buttonSizing = getSizingForComponent('button', sizeToken);
        const emphasis = normalizeToken(props.style) || 'solid';
        const isGhost = emphasis === 'ghost';
        const isOutline = emphasis === 'outline';
        const disabled = Boolean(props.disabled);
        const hasAction = Boolean(props.action);
        const gradientFill = `linear-gradient(135deg, ${accentHighlight}, ${accentShadow})`;
        const background = isGhost || isOutline ? 'transparent' : gradientFill;
        const borderColor = isGhost ? rgbaFromHex(primaryColor, 0.25) : rgbaFromHex(primaryColor, 0.45);
        const textColor = disabled ? '#94a3b8' : isGhost || isOutline ? accentShadow : primaryContrast;

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

        const content = (
          <button
            type="button"
            disabled={disabled}
            className="tablet-button"
            style={{
              background,
              color: textColor,
              border: `1px solid ${disabled ? '#e2e8f0' : borderColor}`,
              borderRadius: buttonSizing.borderRadius || '12px',
              padding: buttonSizing.padding || '14px 20px',
              fontSize: buttonSizing.fontSize || '17px',
              minHeight: buttonSizing.minHeight || '52px',
              cursor: disabled ? 'not-allowed' : hasAction ? 'pointer' : 'help',
              width: props.fullWidth ? '100%' : 'auto',
              boxShadow: disabled ? 'none' : `0 25px 45px ${rgbaFromHex(primaryColor, 0.35)}`,
            }}
            onClick={handleClick}
          >
            {props.icon && <span aria-hidden="true">{props.icon}</span>}
            <span>{props.label || props.content || props.text}</span>
          </button>
        );

        return wrapWithPlacement(content, placement);
      }
      case 'input': {
        const content = (
          <input
            type={props.type || 'text'}
            placeholder={props.placeholder}
            className="tablet-input"
          />
        );
        return wrapWithPlacement(content, placement);
      }
      case 'toggle': {
        const sizeToken = resolveComponentSize(props.size, ergonomicsProfile);
        const toggleSizing = getSizingForComponent('toggle', sizeToken);
        const controlSize = toNumericPixels(toggleSizing.controlSize, 24);
        const trackWidth = `${controlSize * 2}px`;
        const knobSize = `${controlSize - 4}px`;
        const isChecked = typeof props.checked === 'boolean' ? props.checked : false;
        const inputId = resolveControlKey('toggle', props);

        const content = (
          <label
            htmlFor={inputId}
            className="tablet-toggle"
            style={{
              gap: toggleSizing.gap || '12px',
              padding: `${toggleSizing.paddingY || '10px'} 0`,
              fontSize: toggleSizing.labelFontSize || '18px',
            }}
          >
            <span className="tablet-toggle__label">{props.label}</span>
            <span
              className="tablet-toggle__track"
              style={{
                width: trackWidth,
                height: toPixelString(controlSize, 24),
                background: isChecked
                  ? `linear-gradient(130deg, ${accentHighlight}, ${accentShadow})`
                  : 'rgba(148, 163, 184, 0.45)',
              }}
            >
              <span
                className="tablet-toggle__knob"
                style={{
                  width: knobSize,
                  height: knobSize,
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
            />
          </label>
        );

        return wrapWithPlacement(content, placement);
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

        const content = (
          <div className="tablet-slider" style={{ margin: `${sliderSizing.blockSpacing || '22px'} 0` }}>
            <div className="tablet-slider__header">
              <span style={{ fontWeight: 600, fontSize: sliderSizing.labelFontSize || '18px' }}>{props.label}</span>
              <span className="tablet-slider__value">
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
                height: sliderSizing.trackHeight || '32px',
                background: trackFill,
                borderRadius: '999px',
                border: `1px solid ${rgbaFromHex(primaryColor, 0.22)}`,
              }}
            />
            <div className="tablet-slider__markers" style={{ fontSize: sliderSizing.markerFontSize || '14px' }}>
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

        return wrapWithPlacement(content, placement);
      }
      case 'dropdown': {
        const key = resolveControlKey('dropdown', props);
        const options = Array.isArray(props.options) ? props.options : [];
        const defaultValue = props.value ?? options[0]?.value ?? '';
        const currentValue =
          Object.prototype.hasOwnProperty.call(controlValues, key) ? controlValues[key] : defaultValue;
        const sizeToken = resolveComponentSize(props.size, ergonomicsProfile);
        const dropdownSizing = getSizingForComponent('dropdown', sizeToken);

        const content = (
          <label className="tablet-dropdown">
            <span style={{ marginBottom: dropdownSizing.labelGap || '6px', fontWeight: 600, fontSize: dropdownSizing.labelFontSize || '17px' }}>
              {props.label}
            </span>
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
                padding: dropdownSizing.padding || '14px 18px',
                borderRadius: '16px',
                border: `1px solid ${subtleBorder}`,
                background: `linear-gradient(135deg, rgba(255,255,255,0.98), ${rgbaFromHex(primaryColor, 0.08)})`,
                boxShadow: '0 20px 40px rgba(15, 23, 42, 0.12)',
                fontSize: dropdownSizing.controlFontSize || '17px',
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

        return wrapWithPlacement(content, placement);
      }
      case 'statusCard': {
        const tone = props.tone || 'info';
        const palette = {
          info: {
            background: `linear-gradient(125deg, ${rgbaFromHex(primaryColor, 0.18)}, rgba(255, 255, 255, 0.92))`,
            text: accentShadow,
          },
          success: { background: 'linear-gradient(130deg, #dcfce7, #ffffff)', text: '#15803d' },
          warning: { background: 'linear-gradient(130deg, #fef3c7, #ffffff)', text: '#b45309' },
          danger: { background: 'linear-gradient(130deg, #fee2e2, #ffffff)', text: '#b91c1c' },
        };
        const resolved = palette[tone] || palette.info;
        const items = Array.isArray(props.items) ? props.items : [];

        const content = (
          <div
            className="tablet-status-card"
            style={{
              background: resolved.background,
              color: resolved.text,
              border: `1px solid ${rgbaFromHex(primaryColor, 0.12)}`,
            }}
          >
            <div className="tablet-status-card__header">
              {props.icon && <span className="tablet-status-card__icon">{props.icon}</span>}
              <span className="tablet-status-card__title">{props.title}</span>
            </div>
            {props.value && <div className="tablet-status-card__value">{props.value}</div>}
            {items.length > 0 && (
              <div className="tablet-status-card__list">
                {items.map((item, index) => (
                  <div key={`${item.label}-${index}`} className="tablet-status-card__row">
                    <span>{item.label}</span>
                    <span>{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

        return wrapWithPlacement(content, placement);
      }
      default:
        return null;
    }
  };

  const sidebarEntries = useMemo(() => {
    if (!ui) {
      return [];
    }

    return [
      { label: 'Components', value: Array.isArray(ui.components) ? ui.components.length : '—' },
      { label: 'Theme color', value: primaryColor },
      { label: 'Ergonomics', value: ergonomicsProfile },
      { label: 'Thing context', value: ui?.context?.thingId || '—' },
    ];
  }, [ui, primaryColor, ergonomicsProfile]);

  return (
    <div className="tablet-shell">
      <div className="tablet-panel">
        <aside className="tablet-sidebar">
          <div className="tablet-sidebar__header">
            <h1>Tablet / Laptop Dashboard</h1>
            <p>Listening for KB layouts with placement hints.</p>
          </div>
          <div className="tablet-sidebar__meta">
            {sidebarEntries.map((entry) => (
              <div key={entry.label} className="tablet-sidebar__meta-row">
                <span>{entry.label}</span>
                <strong>{entry.value}</strong>
              </div>
            ))}
          </div>
          {lastUpdate && (
            <div className="tablet-sidebar__footer">
              <span>Last update</span>
              <strong>{new Date(lastUpdate).toLocaleTimeString()}</strong>
            </div>
          )}
          {actionState.status && (
            <div
              className="tablet-sidebar__status"
              style={{
                background: actionStatusStyles[actionState.status]?.background,
                color: actionStatusStyles[actionState.status]?.color,
              }}
            >
              {actionState.message}
            </div>
          )}
        </aside>
        <main className="tablet-stage">
          <div className="tablet-stage__header">
            <div>
              <h2>Live layout stream</h2>
              <p>LLM-generated controls snapped to a 12-column grid.</p>
            </div>
            <span className="tablet-stage__label">Device ID: {deviceId}</span>
          </div>
          <section className="tablet-grid">
            {ui ? renderUi(ui) : <div className="tablet-empty">Waiting for the core system to send a layout…</div>}
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
