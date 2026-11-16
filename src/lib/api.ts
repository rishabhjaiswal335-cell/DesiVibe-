import type { SavedSessionAccount, UserProfile } from '../types.ts';

const ACTIVE_TOKEN_KEY = 'desivibe_active_token';
const ACCOUNTS_VAULT_KEY = 'desivibe_accounts_vault';
const FEED_CACHE_KEY = 'desivibe_offline_feed_cache';

export function getActiveToken(): string | null {
  return localStorage.getItem(ACTIVE_TOKEN_KEY);
}

export function setActiveToken(token: string | null) {
  if (token) {
    localStorage.setItem(ACTIVE_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(ACTIVE_TOKEN_KEY);
  }
}

export function getSavedAccounts(): SavedSessionAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_VAULT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveAccountToVault(token: string, user: UserProfile) {
  const accounts = getSavedAccounts().filter((a) => a.user.id !== user.id);
  accounts.unshift({ token, user });
  localStorage.setItem(ACCOUNTS_VAULT_KEY, JSON.stringify(accounts.slice(0, 6)));
  setActiveToken(token);
}

export function removeAccountFromVault(userId: string) {
  const remaining = getSavedAccounts().filter((a) => a.user.id !== userId);
  localStorage.setItem(ACCOUNTS_VAULT_KEY, JSON.stringify(remaining));
  if (remaining.length > 0) {
    setActiveToken(remaining[0].token);
    return remaining[0];
  }
  setActiveToken(null);
  return null;
}

export function cacheFeedOffline(posts: unknown[]) {
  try {
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ updatedAt: Date.now(), posts }));
  } catch {
    // Ignore quota limits
  }
}

export function readOfflineFeedCache<T>(): T[] {
  try {
    const raw = localStorage.getItem(FEED_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.posts) ? parsed.posts : [];
  } catch {
    return [];
  }
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You appear to be offline. Reconnect to sync with DesiVibe.');
  }

  const token = getActiveToken();
  const headers: Record<string, string> = {
    ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url =
    path.startsWith('http://') || path.startsWith('https://')
      ? path
      : new URL(path, window.location.origin).toString();
  const method = (options.method || 'GET').toUpperCase();
  const maxAttempts = method === 'GET' || method === 'HEAD' ? 2 : 1;

  let res: Response | null = null;
  let lastNetworkErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await fetch(url, {
        ...options,
        headers,
        credentials: options.credentials ?? 'same-origin',
      });
      break;
    } catch (err) {
      lastNetworkErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  if (!res) {
    const msg =
      lastNetworkErr instanceof Error && lastNetworkErr.message !== 'Failed to fetch'
        ? lastNetworkErr.message
        : 'Unable to reach DesiVibe server. Please check your connection.';
    throw new Error(msg);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

type WsListener = (payload: any) => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<WsListener>>();
  private reconnectTimer: number | null = null;
  private currentToken: string | null = null;
  private intentionalClose = false;

  connect(token: string | null) {
    if (this.ws && this.currentToken === token && this.ws.readyState <= WebSocket.OPEN) {
      return;
    }
    this.disconnect();
    this.intentionalClose = false;
    this.currentToken = token;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    const socket = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);
    this.ws = socket;

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const set = this.listeners.get(msg.event);
        if (set) {
          set.forEach((fn) => fn(msg.payload));
        }
      } catch {
        // Ignore invalid frames
      }
    };

    socket.onclose = () => {
      if (!this.intentionalClose) {
        this.reconnectTimer = window.setTimeout(() => {
          this.connect(this.currentToken);
        }, 2500);
      }
    };
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(event: string, payload: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, payload }));
    }
  }

  on(event: string, fn: WsListener) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  }
}

export const wsClient = new RealtimeClient();
