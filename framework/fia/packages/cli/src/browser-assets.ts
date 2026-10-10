// Self-contained scripts served by the gateway in both Vite and packaged applications.
export const browserRuntime = String.raw`(() => {
  const opening = location.pathname === '/_fia/browser/open';
  if (!opening && new URLSearchParams(location.search).get('fiaBrowser') !== '1') return;
  const key = 'fia.browser.session';
  const nativeFetch = window.fetch.bind(window);
  let session;
  let ended = false;
  const listeners = new Set();
  const expired = () => {
    if (ended) return;
    ended = true;
    sessionStorage.removeItem(key);
    session = undefined;
    for (const listener of listeners) listener();
    const show = () => {
      if (document.getElementById('fia-browser-ended')) return;
      const host = document.createElement('div');
      host.id = 'fia-browser-ended';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
      host.attachShadow({mode:'closed'}).innerHTML = '<style>:host{color-scheme:light dark}main{box-sizing:border-box;display:grid;place-content:center;gap:12px;height:100%;padding:32px;background:Canvas;color:CanvasText;font:15px system-ui;text-align:center}h1{font-size:22px;margin:0}p{max-width:480px;margin:0;line-height:1.6}</style><main role="alert"><h1>浏览器连接已结束</h1><p>请回到应用，点击标题栏最右侧的“在浏览器中打开”按钮重新连接。</p></main>';
      document.body.append(host);
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, {once:true});
  };
  const timed = (promise) => new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('Browser initialization timed out')), 5000);
    promise.then(value => {clearTimeout(timer);resolve(value)}, error => {clearTimeout(timer);reject(error)});
  });
  const send = (message) => timed(new Promise((resolve,reject) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = event => {channel.port1.close();event.data?.ok ? resolve() : reject(new Error('Browser binding failed'))};
    navigator.serviceWorker.controller.postMessage(message, [channel.port2]);
  }));
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
    if (event.source !== navigator.serviceWorker.controller) return;
    if (event.data?.type === 'fia:need-auth' && session && !ended)
      event.source.postMessage({type:'fia:auth', nonce:event.data.nonce, token:session.token});
    if (event.data?.type === 'fia:expired') expired();
  });
  const ready = (async () => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) throw new Error('Service Worker unavailable');
    if (opening) {
      const ticket = location.hash.slice(1);
      history.replaceState(null, '', location.pathname);
      sessionStorage.removeItem(key);
      const response = await nativeFetch('/_fia/browser/exchange', {method:'POST', credentials:'omit', redirect:'error', headers:{'content-type':'application/json','x-fia-browser-bootstrap':'1'}, body:JSON.stringify({ticket})});
      if (!response.ok) throw new Error('Browser authorization failed');
      session = await response.json();
      sessionStorage.setItem(key, JSON.stringify(session));
    } else {
      session = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!session || session.generation !== new URLSearchParams(location.search).get('fiaGeneration')) throw new Error('Stale browser session');
    }
    const workerURL = location.origin + '/_fia/browser/worker.js?generation=' + encodeURIComponent(session.generation);
    await timed(navigator.serviceWorker.register(workerURL, {scope:'/', updateViaCache:'none'}));
    const controlled = () => navigator.serviceWorker.controller?.scriptURL === workerURL;
    if (!controlled()) await timed(new Promise(resolve => {
      const changed = () => {if (controlled()) {navigator.serviceWorker.removeEventListener('controllerchange', changed);resolve()}};
      navigator.serviceWorker.addEventListener('controllerchange', changed);
      changed();
    }));
    await send({type:'fia:bind', token:session.token});
    const response = await nativeFetch('/_fia/browser/session', {credentials:'omit', redirect:'error', headers:{authorization:'Bearer '+session.token}});
    if (!response.ok || (await response.json()).generation !== session.generation) throw new Error('Stale browser session');
    if (opening) location.replace(session.route);
  })();
  const bridge = {
    ready,
    ended: () => ended,
    expire: expired,
    onEnd: listener => {listeners.add(listener);return () => listeners.delete(listener)},
    request: async (path, init = {}) => {
      await ready;
      if (ended || !session) throw new Error('Browser authorization ended');
      const url = new URL(path, location.href);
      if (url.origin !== location.origin) throw new Error('Cross-origin browser request');
      const headers = new Headers(init.headers);
      headers.set('authorization', 'Bearer '+session.token);
      let response;
      try {response = await nativeFetch(url, {...init, headers, credentials:'omit', redirect:'error', cache:'no-store'})}
      catch (error) {if (!init.signal?.aborted) expired();throw error}
      if (response.status === 401) expired();
      return response;
    }
  };
  window.__FIA_BROWSER__ = bridge;
  ready.catch(expired);
})();`;

export const browserWorker = String.raw`
const sessions = new Map();
const pending = new Map();
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  const source = event.source;
  if (!source || !source.id || new URL(source.url).origin !== self.location.origin) return;
  const data = event.data;
  if (!data || !/^[a-f0-9]{64}$/.test(data.token || '')) return;
  if (data.type === 'fia:bind') {
    sessions.set(source.id, data.token);
    event.ports[0]?.postMessage({ok:true});
  } else if (data.type === 'fia:auth') {
    const request = pending.get(source.id);
    if (request && request.nonce === data.nonce) {
      sessions.set(source.id, data.token);
      request.resolve(data.token);
    }
  }
});
async function credential(id) {
  if (sessions.has(id)) return sessions.get(id);
  if (pending.has(id)) return pending.get(id).promise;
  const client = await self.clients.get(id);
  if (!client || new URL(client.url).origin !== self.location.origin) return;
  if (pending.has(id)) return pending.get(id).promise;
  const nonce = crypto.randomUUID();
  let resolve;
  const promise = new Promise(done => {resolve=done});
  pending.set(id, {nonce,promise,resolve});
  const timer = setTimeout(() => resolve(undefined), 5000);
  client.postMessage({type:'fia:need-auth',nonce});
  try {return await promise} finally {clearTimeout(timer);pending.delete(id)}
}
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.mode === 'navigate' || !event.clientId) return;
  if (!(url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/_fia/'))) return;
  if (['/_fia/browser/open','/_fia/browser/runtime.js','/_fia/browser/worker.js','/_fia/browser/exchange'].includes(url.pathname)) return;
  event.respondWith((async () => {
    const token = await credential(event.clientId);
    if (!token) return new Response('Browser authorization required', {status:401});
    const headers = new Headers(request.headers);
    headers.set('authorization', 'Bearer '+token);
    // CORS mode permits authentication on no-cors subresources and preserves Origin
    // for Safari POSTs under no-referrer. The exact origin and redirects are checked above.
    const response = await fetch(new Request(request, {headers, mode:'cors', credentials:'omit', redirect:'error', cache:'no-store'}));
    if (response.status === 401) {
      sessions.delete(event.clientId);
      const client = await self.clients.get(event.clientId);
      client?.postMessage({type:'fia:expired'});
    }
    return response;
  })());
});
`;

export const browserBootstrap =
  '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open in Browser</title><script src="/_fia/browser/runtime.js"></script></head><body><p>正在连接应用…</p></body></html>';
export function injectBrowserRuntime(html: string): string {
  if (html.includes('src="/_fia/browser/runtime.js"')) return html;
  const script = '<script src="/_fia/browser/runtime.js"></script>';
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, "$&" + script)
    : script + html;
}
