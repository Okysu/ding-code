import type { AppState, Bootstrap, ChangeEvent, Candidate } from '../../../../shared/types';
const fragment = new URLSearchParams(location.hash.slice(1));
const token =
  window.__DING_BOOT__?.token ??
  fragment.get('token') ??
  sessionStorage.getItem('ding-code.token') ??
  '';
if (token && !window.__DING_BOOT__) sessionStorage.setItem('ding-code.token', token);
if (fragment.has('token')) history.replaceState(null, '', location.pathname + location.search);
export const boot: Bootstrap = window.__DING_BOOT__ ?? {
  api: location.origin,
  token,
  locale: 'en-US',
  compact: false,
};
// The actual Webview origin is registered through VS Code's private message channel.
// cspSource identifies resource hosts and is not necessarily the document's Origin.
export function prepareWebview(): Promise<void> {
  if (!window.__VSCODE__) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const receive = (event: MessageEvent) => {
      if (event.data?.type === 'connected') {
        clearTimeout(timeout);
        window.removeEventListener('message', receive);
        resolve();
      }
    };
    const timeout = setTimeout(() => {
      window.removeEventListener('message', receive);
      reject(new Error('network'));
    }, 10000);
    window.addEventListener('message', receive);
    window.__VSCODE__!.postMessage({ type: 'connect', origin: location.origin });
  });
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${boot.api}/api/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new Error('network');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? 'operationFailed');
  }
  return response.json();
}
export const getState = () => api<AppState>('state');
export async function download(path: string, filename: string) {
  const response = await fetch(`${boot.api}/api/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('operationFailed');
  saveBlob(await response.blob(), filename);
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function streamAI(input: object, delta: (text: string) => void, signal: AbortSignal) {
  const response = await fetch(`${boot.api}/api/ai`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new Error((await response.json()).error);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    completed = false,
    result: { scanId: string; candidates: Candidate[] } | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (!frame.startsWith('data: ')) continue;
        const event = JSON.parse(frame.slice(6));
        if (event.error) throw new Error(event.error);
        if (event.delta) delta(event.delta);
        if (event.done) {
          completed = true;
          result = event.result;
        }
      }
      if (done) break;
    }
    if (!completed) throw new Error('incompleteStream');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function subscribe(
  onEvent: (event: ChangeEvent) => void,
  onConnection: (connected: boolean) => void,
) {
  let closed = false,
    ws: WebSocket,
    timer: ReturnType<typeof setTimeout>;
  let delay = 500;
  const connect = () => {
    ws = new WebSocket(`${boot.api.replace(/^http/, 'ws')}/ws`, ['ding-code', token]);
    ws.onopen = () => {
      delay = 500;
      onConnection(true);
      onEvent({ type: 'state' });
      onEvent({ type: 'changed' });
    };
    ws.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data));
      } catch {
        /* Ignore malformed events. */
      }
    };
    ws.onclose = () => {
      onConnection(false);
      if (!closed) {
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10000);
      }
    };
    ws.onerror = () => ws.close();
  };
  if (token) connect();
  return () => {
    closed = true;
    clearTimeout(timer);
    ws?.close();
  };
}
