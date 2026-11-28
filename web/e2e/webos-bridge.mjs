// webOS bridge double for the packaged UI tests. The app's credential store
// (src/webos-credentials.js) talks to LG Keymanager3 through
// window.webOS.service.request; on a TV that service encrypts the Home
// Assistant token with an AES-GCM key. This mock implements the same luna
// method contract (generateKey/begin/finish/abort/removeKey) in page memory so
// a saved envelope survives page.reload() like a relaunch on the TV.
//
// Installed with page.addInitScript, so it re-runs before every navigation and
// reload. webOSTV.js replaces window.webOS wholesale when it loads, so the
// defineProperty below keeps the mock in place with a no-op setter.
export function keymanagerBridge() {
  const KEY_PREFIX = 'HC1';
  const store = { key: false, handle: 0, purposes: new Map() };

  function begin(parameters) {
    const purpose = parameters.params.purpose[0];
    const handle = String(++store.handle);
    store.purposes.set(handle, purpose);
    const iv = purpose === 'encrypt'
      ? btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(12))))
      : parameters.params.iv;
    return { returnValue: true, handle, iv };
  }

  function finish(parameters) {
    const purpose = store.purposes.get(parameters.handle);
    if (purpose === undefined) return { returnValue: false, errorCode: -3 };
    store.purposes.delete(parameters.handle);
    // A marker-prefixed pass-through stands in for AES-GCM; only the envelope
    // contract (invertible, opaque in storage) is what the app depends on.
    if (purpose === 'encrypt') return { returnValue: true, output: btoa(KEY_PREFIX + parameters.data) };
    const decoded = atob(parameters.data);
    if (!decoded.startsWith(KEY_PREFIX)) return { returnValue: false, errorCode: -2 };
    return { returnValue: true, output: decoded.slice(KEY_PREFIX.length) };
  }

  function request(uri, parameters) {
    const method = parameters?.method;
    const done = response => {
      queueMicrotask(() => {
        if (response.returnValue === true) parameters.onSuccess?.(response);
        else parameters.onFailure?.(response);
      });
      return { cancel() {} };
    };
    if (uri !== 'luna://com.webos.service.keymanager3') return done({ returnValue: false, errorCode: -1 });
    if (method === 'generateKey') {
      if (store.key) return done({ returnValue: false, errorCode: -10002 });
      store.key = true;
      return done({ returnValue: true });
    }
    if (method === 'begin') return done(begin(parameters.parameters));
    if (method === 'finish') return done(finish(parameters.parameters));
    if (method === 'abort') {
      store.purposes.delete(parameters.parameters.handle);
      return done({ returnValue: true });
    }
    if (method === 'removeKey') {
      if (!store.key) return done({ returnValue: false, errorCode: -10001 });
      store.key = false;
      return done({ returnValue: true });
    }
    return done({ returnValue: false, errorCode: -1 });
  }

  const mock = { service: { request } };
  Object.defineProperty(window, 'webOS', { configurable: true, get: () => mock, set: () => {} });
}