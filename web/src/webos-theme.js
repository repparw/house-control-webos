export const APPEARANCE_STORAGE_KEY = 'house-control:webos:theme:v1';

/** @typedef {'oled' | 'light' | 'auto'} AppearanceMode */
/** @typedef {'oled' | 'day'} AppearanceTheme */
/** @typedef {Pick<Storage, 'getItem' | 'setItem'>} AppearanceStorage */

/** @type {readonly AppearanceMode[]} */
export const APPEARANCE_MODES = Object.freeze(['oled', 'light', 'auto']);

/** @type {Readonly<Record<AppearanceMode, string>>} */
export const APPEARANCE_LABELS = Object.freeze({
  oled: 'OLED Dark',
  light: 'Light',
  auto: 'Auto',
});

/**
 * @param {unknown} value
 * @returns {AppearanceMode}
 */
export function normalizeAppearanceMode(value) {
  if (value === 'oled' || value === 'light' || value === 'auto') return value;
  return 'oled';
}

/** @returns {AppearanceStorage | null} */
function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * @param {AppearanceStorage | null} [storage]
 * @returns {AppearanceMode}
 */
export function getAppearanceMode(storage = defaultStorage()) {
  try {
    return normalizeAppearanceMode(storage?.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return 'oled';
  }
}

/**
 * @param {unknown} mode
 * @param {AppearanceStorage | null} [storage]
 * @returns {AppearanceMode}
 */
export function setAppearanceMode(mode, storage = defaultStorage()) {
  const normalized = normalizeAppearanceMode(mode);
  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, normalized);
  } catch {
    // Appearance preferences are best effort.
  }
  return normalized;
}

/**
 * @param {AppearanceMode} mode
 * @param {boolean} [prefersLight]
 * @returns {AppearanceTheme}
 */
export function resolveAppearance(mode, prefersLight = false) {
  if (mode === 'light' || (mode === 'auto' && prefersLight)) return 'day';
  return 'oled';
}

/**
 * @typedef {object} AppearanceApplyOptions
 * @property {unknown} [mode]
 * @property {{ setDaylight?: (day: boolean, instant?: boolean) => void } | null} [world]
 * @property {Document | null} [document]
 * @property {((query: string) => MediaQueryList) | null} [matchMedia]
 * @property {boolean} [instant]
 */

/**
 * @param {AppearanceApplyOptions} [options]
 * @returns {{ mode: AppearanceMode, theme: AppearanceTheme, day: boolean }}
 */
export function applyAppearance({
  mode,
  world = null,
  document = globalThis.document,
  matchMedia = globalThis.matchMedia,
  instant = false,
} = {}) {
  const normalizedMode = mode === undefined ? getAppearanceMode() : normalizeAppearanceMode(mode);
  const prefersLight = Boolean(matchMedia?.('(prefers-color-scheme: light)')?.matches);
  const theme = resolveAppearance(normalizedMode, prefersLight);
  const day = theme === 'day';

  if (document?.documentElement) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.appearance = normalizedMode;
  }

  const themeColor = document?.querySelector?.('meta[name="theme-color"]');
  themeColor?.setAttribute('content', day ? '#e9eaed' : '#000000');
  world?.setDaylight?.(day, instant);

  return { mode: normalizedMode, theme, day };
}

/**
 * @typedef {object} AppearanceSelectorOptions
 * @property {unknown} [mode]
 * @property {(mode: AppearanceMode) => void} [onChange]
 * @property {Document | null} [document]
 */

/**
 * @param {AppearanceSelectorOptions} options
 * @returns {{ element: HTMLElement, sync: (nextMode: unknown) => void }}
 */
export function createAppearanceSelector({
  mode,
  onChange,
  document = globalThis.document,
}) {
  if (!document) throw new Error('Appearance controls require a document.');

  const element = document.createElement('div');
  element.className = 'appearance-control';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Appearance');

  const options = document.createElement('div');
  options.className = 'device-filters appearance-options';
  element.append(options);

  let activeMode = normalizeAppearanceMode(mode);
  /** @type {HTMLButtonElement[]} */
  const buttons = [];

  /** @param {unknown} nextMode */
  function sync(nextMode) {
    activeMode = normalizeAppearanceMode(nextMode);
    for (const button of buttons) {
      const active = button.dataset.appearance === activeMode;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('selected', active);
    }
  }

  for (const value of APPEARANCE_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'device-filter appearance-option';
    button.dataset.appearance = value;
    button.textContent = APPEARANCE_LABELS[value];
    button.addEventListener('click', () => {
      sync(value);
      onChange?.(value);
    });
    buttons.push(button);
    options.append(button);
  }

  sync(activeMode);
  return { element, sync };
}
