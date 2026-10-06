// services/deviceBridge.js
import { Platform } from 'react-native';

class DeviceBridge {
  constructor() {
    this.ws = null;
    this.listeners = [];
    this.reconnectTimer = null;
    this.activeUrl = null;
  }

  connect(serverUrl) {
    const defaultUrl =
      Platform.OS === 'web'
        ? 'ws://localhost:8081'
        : 'ws://192.168.4.1:8081';

    const targetUrl = serverUrl || defaultUrl;
    this.activeUrl = targetUrl;

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      console.log(`[Hardware Bridge] Connecting to ${targetUrl}...`);
      this.ws = new WebSocket(targetUrl);

      this.ws.onopen = () => {
        console.log('[Hardware Bridge] Connected to hardware bridge');
      };

      this.ws.onmessage = (event) => {
        let isDrowsy = false;
        let hasEvent = false;

        try {
          const data = JSON.parse(event.data);
          if (data.type === 'DROWSINESS_UPDATE' || data.type === 'DROWSINESS_ALERT') {
            isDrowsy = data.isDrowsy !== undefined ? Boolean(data.isDrowsy) : true;
            hasEvent = true;
          }
        } catch (e) {
          if (typeof event.data === 'string') {
            if (event.data.includes('isDrowsy = True') || event.data.includes('DROWSINESS_ALERT')) {
              isDrowsy = true;
              hasEvent = true;
            } else if (event.data.includes('isDrowsy = False')) {
              isDrowsy = false;
              hasEvent = true;
            }
          }
        }

        if (hasEvent) {
          this.notifyListeners({
            type: 'DROWSINESS_UPDATE',
            isDrowsy
          });
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[Hardware Bridge] Connection error:', err?.message || err);
      };

      this.ws.onclose = () => {
        console.log('[Hardware Bridge] Connection closed. Retrying in 5s...');
        this.cleanup();
        this.reconnectTimer = setTimeout(() => this.connect(this.activeUrl), 5000);
      };
    } catch (e) {
      console.warn('[Hardware Bridge] WebSocket initialization failed:', e);
    }
  }

  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  notifyListeners(data) {
    this.listeners.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error('[Hardware Bridge] Listener error:', err);
      }
    });
  }

  cleanup() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const deviceBridge = new DeviceBridge();