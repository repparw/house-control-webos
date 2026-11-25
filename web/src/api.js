import { webosAPI } from './webos.js';

export function webosVisibility(visible) {
  return webosAPI('/api/webos/visibility', { visible: visible !== false });
}

if (typeof document !== 'undefined') {
  let visible = !document.hidden;
  const updateVisibility = () => {
    const next = !document.hidden;
    if (next === visible) return;
    visible = next;
    webosVisibility(visible).catch(() => {});
  };
  document.addEventListener('visibilitychange', updateVisibility);
  document.addEventListener('webkitvisibilitychange', updateVisibility);
  if (document.hidden) webosVisibility(false).catch(() => {});
}

/**
 * Paths listed in WebOSRequestBodies must send exactly that body shape.
 * @template {string} P
 * @param {P} path
 * @param {P extends keyof import('./webos.js').WebOSRequestBodies ? import('./webos.js').WebOSRequestBodies[P] : object} [body]
 * @returns {Promise<any>}
 */
export async function api(path, body) {
  return webosAPI(path, body);
}
