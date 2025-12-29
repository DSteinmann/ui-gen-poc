import { WebSocketServer, WebSocket } from 'ws';
import { deviceRegistry } from '../services/registry.js';
import { nowIsoString } from '../utils.js';

export const deviceSockets = new Map(); // deviceId -> Set<WebSocket>
export const latestUiByDevice = new Map(); // deviceId -> last generated UI definition

export const ensureSocketSet = (deviceId) => {
  if (!deviceId) return null;
  if (!deviceSockets.has(deviceId)) {
    deviceSockets.set(deviceId, new Set());
  }
  return deviceSockets.get(deviceId);
};

let wss;

export const initializeWebSocketServer = (server) => {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, request) => {
    // Devices connect over websocket to receive UI pushes; we tag each connection with a deviceId when provided.
    let deviceId;

    try {
      const requestUrl = request.url || '';
      const queryString = requestUrl.includes('?') ? requestUrl.split('?')[1] : '';
      const params = new URLSearchParams(queryString);
      deviceId = params.get('deviceId') || undefined;
    } catch (error) {
      console.error('Failed to parse websocket query params:', error);
    }

    if (deviceId) {
      const sockets = ensureSocketSet(deviceId);
      sockets.add(ws);
      ws.deviceId = deviceId;
      console.log(`WebSocket client connected for device ${deviceId}`);
    } else {
      console.log('WebSocket client connected without deviceId; broadcasting mode enabled.');
    }

    const initialUi = deviceId ? latestUiByDevice.get(deviceId) : null;
    const payload = {
      deviceId: deviceId || null,
      generatedAt: nowIsoString(),
      ui: initialUi || {
        type: 'container',
        children: [
          { type: 'text', content: 'Awaiting UI definition from core system…' },
        ],
      },
    };

    if (deviceId && initialUi) {
      console.log(`[Core] Delivered cached UI to device '${deviceId}' on socket connect.`);
    }

    ws.send(JSON.stringify(payload));

    ws.on('close', () => {
      if (ws.deviceId) {
        const sockets = deviceSockets.get(ws.deviceId);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) {
            deviceSockets.delete(ws.deviceId);
          }
        }
        console.log(`WebSocket client disconnected for device ${ws.deviceId}`);
      } else {
        console.log('WebSocket client disconnected.');
      }
    });
  });

  return wss;
};

// Cache the latest UI per device and fan out over websockets; late joiners receive the cached definition immediately.
export const dispatchUiToClients = (deviceId, uiDefinition) => {
  if (deviceId) {
    latestUiByDevice.set(deviceId, uiDefinition);
  }

  const payload = JSON.stringify({
    deviceId: deviceId || null,
    generatedAt: nowIsoString(),
    ui: uiDefinition,
  });

  if (deviceId) {
    const sockets = deviceSockets.get(deviceId);
    if (sockets && sockets.size > 0) {
      sockets.forEach((socket) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(payload);
        }
      });
    } else {
      console.log(`[Core] Cached UI for device '${deviceId}' until a socket connects.`);
    }
    return;
  }

  // Broadcast payload to any connected socket when no specific device target is provided.
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }
};
