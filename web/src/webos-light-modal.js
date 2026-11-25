// Compact light controls and the D-pad OK repeat guard for House Control for webOS.
// This module owns two TV-specific input behaviors so src/main.js stays small:
//   1. held OK/Space repeats are dropped on device buttons instead of spamming toggles;
//   2. a compact light modal body (brightness, color temperature and RGB when supported).
// It uses only the injected document and reads state through getState(), keeping the
// adapter and renderer out of the input path.

export const LONG_PRESS_MS = 450;

const DEVICE_CONTROL_SELECTOR = '.light-row, .power, .step, .scene-button, #all-off';
const STATUS_LABELS = {
  stale: 'Last known',
  unavailable: 'Unavailable',
  disconnected: 'Offline',
  unsupported: 'Unsupported',
  invalid: 'Invalid entity',
};
const DEFAULT_CAPABILITIES = { brightness: false, temp: false, color: false, minTemp: 2200, maxTemp: 6500 };
const BRIGHTNESS_STEP = 0.1;
const BRIGHTNESS_MIN = 0.05;
const BRIGHTNESS_MAX = 1;
const TEMP_STEP = 300;
const MID_TEMPERATURE = 3000;

export const COLOR_SWATCHES = [
  { name: 'Warm', hex: '#ff9f43' },
  { name: 'Red', hex: '#ff4d4f' },
  { name: 'Rose', hex: '#ff6b9d' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Green', hex: '#22c55e' },
];

export const KELVIN_PRESETS = [2700, 3200, 4000, 5000, 6500];

/**
 * True when a repeated OK/Space keydown belongs to a device control button. Those repeats
 * must be dropped before they reach the button's click activation.
 * @param {{ repeat?: boolean, key?: string, keyCode?: number, target?: any }} [event]
 * @returns {boolean}
 */
export function shouldIgnoreDeviceRepeat(event) {
  if (!event?.repeat) return false;
  if (event.key !== 'Enter' && event.key !== ' ' && event.keyCode !== 13) return false;
  const candidates = /** @type {Array<any>} */ ([event.target, globalThis.document?.activeElement]);
  return candidates.some(candidate => typeof candidate?.matches === 'function' && candidate.matches(DEVICE_CONTROL_SELECTOR));
}

/**
 * Attach D-pad OK and Magic Remote pointer handling to one device button.
 *
 * Held OK never repeat-toggles: repeats are ignored, a hold below the long-press
 * threshold toggles once on release, and a hold past the threshold opens the light
 * controls and suppresses the release toggle. A pointer long-press does the same and
 * swallows the trailing click.
 *
 * @param {any} button
 * @param {{
 *   onToggle?: () => void,
 *   onLongPress?: () => void,
 *   longPressMs?: number,
 *   setTimer?: (callback: () => void, ms: number) => any,
 *   clearTimer?: (handle: any) => void,
 * }} [options]
 * @returns {() => void} detach
 */
export function attachLightRowInput(button, options = {}) {
  const {
    onToggle = () => {},
    onLongPress = () => {},
    longPressMs = LONG_PRESS_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = options;

  let holdActive = false;
  let holdTimer = null;
  let longPressed = false;
  let pointerTimer = null;
  let suppressNextClick = false;

  const cancelHold = () => {
    if (holdTimer !== null) {
      clearTimer(holdTimer);
      holdTimer = null;
    }
    holdActive = false;
    longPressed = false;
  };
  const cancelPointerHold = () => {
    if (pointerTimer !== null) {
      clearTimer(pointerTimer);
      pointerTimer = null;
    }
  };
  const cancelAll = () => {
    cancelHold();
    cancelPointerHold();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape' || event.key === 'BrowserBack' || event.keyCode === 461) {
      cancelAll();
      return;
    }
    const enter = event.key === 'Enter' || event.keyCode === 13;
    const space = event.key === ' ';
    if (!enter && !space) return;
    if (event.repeat || button.disabled) {
      event.preventDefault();
      return;
    }
    if (!enter) return; // Space activates through the native click on keyup.
    event.preventDefault();
    if (holdActive) return;
    holdActive = true;
    longPressed = false;
    holdTimer = setTimer(() => {
      holdTimer = null;
      if (!holdActive || button.disabled) return;
      longPressed = true;
      onLongPress();
    }, longPressMs);
  };

  const onKeyUp = (event) => {
    const enter = event.key === 'Enter' || event.keyCode === 13;
    if (!enter || !holdActive) return;
    const wasLongPressed = longPressed;
    cancelHold();
    if (!wasLongPressed && !button.disabled) onToggle();
  };

  const onBlur = () => cancelAll();

  const onPointerDown = (event) => {
    if (event.isPrimary === false) return;
    if (event.button != null && event.button !== 0) return;
    if (button.disabled) return;
    cancelPointerHold();
    pointerTimer = setTimer(() => {
      pointerTimer = null;
      suppressNextClick = true;
      onLongPress();
    }, longPressMs);
  };

  const onPointerEnd = () => cancelPointerHold();

  const onClick = () => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if (button.disabled) return;
    onToggle();
  };

  button.addEventListener('keydown', onKeyDown);
  button.addEventListener('keyup', onKeyUp);
  button.addEventListener('blur', onBlur);
  button.addEventListener('pointerdown', onPointerDown);
  button.addEventListener('pointerup', onPointerEnd);
  button.addEventListener('pointercancel', onPointerEnd);
  button.addEventListener('pointerleave', onPointerEnd);
  button.addEventListener('click', onClick);

  return function detach() {
    cancelAll();
    suppressNextClick = false;
    button.removeEventListener('keydown', onKeyDown);
    button.removeEventListener('keyup', onKeyUp);
    button.removeEventListener('blur', onBlur);
    button.removeEventListener('pointerdown', onPointerDown);
    button.removeEventListener('pointerup', onPointerEnd);
    button.removeEventListener('pointercancel', onPointerEnd);
    button.removeEventListener('pointerleave', onPointerEnd);
    button.removeEventListener('click', onClick);
  };
}

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {string} [cls]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function lightEl(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {Document} doc
 * @param {string} cls
 * @param {string} label
 * @returns {HTMLButtonElement}
 */
function lightButton(doc, cls, label) {
  const node = /** @type {HTMLButtonElement} */ (doc.createElement('button'));
  node.type = 'button';
  node.className = cls;
  node.setAttribute('aria-label', label);
  return node;
}

/**
 * @param {any} state
 * @returns {string}
 */
function lightStatus(state) {
  if (state.pending) return 'Pending';
  if (state.error) return state.error;
  const labels = /** @type {Record<string, string>} */ (STATUS_LABELS);
  return labels[state.status] || '';
}

/**
 * @param {any} state
 * @param {number} fallback
 * @returns {number}
 */
function tempOr(state, fallback) {
  return Number.isFinite(state.temp) ? state.temp : fallback;
}

/**
 * @typedef {object} LightPanelOptions
 * @property {{ id: string, name: string }} device
 * @property {() => any} getState
 * @property {string} [roomName]
 * @property {(action: any) => void} [onAction]
 * @property {() => void} [onClose]
 * @property {((name: string) => any) | null} [createIcon]
 * @property {Document} [document]
 */

/**
 * Build the light-controls modal body and a sync() helper that reconciles it with the
 * adapter state. The caller owns the backdrop, focus and commands.
 *
 * @param {LightPanelOptions} [options]
 * @returns {{ panel: HTMLElement, sync: (next?: any) => void }}
 */
export function createLightControlsPanel(options = /** @type {LightPanelOptions} */ ({})) {
  const {
    device,
    getState,
    roomName = '',
    onAction = () => {},
    onClose = () => {},
    createIcon = null,
    document: doc = globalThis.document,
  } = options;

  const readState = () => {
    const state = typeof getState === 'function' ? getState() : null;
    return state && typeof state === 'object' ? state : {};
  };

  const initial = readState();
  const caps = initial?.capabilities || DEFAULT_CAPABILITIES;

  const panel = /** @type {HTMLElement} */ (doc.createElement('section'));
  panel.className = 'sync-panel light-modal';

  const addIcon = (button, name) => {
    if (!createIcon) return;
    const node = createIcon(name);
    if (node) button.append(node);
  };

  const header = lightEl(doc, 'div', 'light-modal-header');
  const back = lightButton(doc, 'back-button', 'Back');
  addIcon(back, 'ArrowLeft');
  back.append(lightEl(doc, 'span', '', 'Back'));
  back.addEventListener('click', () => onClose());

  const heading = lightEl(doc, 'div', 'light-modal-heading');
  const title = lightEl(doc, 'h2', 'light-modal-title');
  const subtitle = lightEl(doc, 'p', 'sync-description light-modal-subtitle');
  heading.append(title, subtitle);

  const power = lightButton(doc, 'power light-power', 'Toggle power');
  addIcon(power, 'Power');
  const powerLabel = lightEl(doc, 'span', 'light-power-label');
  power.append(powerLabel);
  power.addEventListener('click', () => onAction({ kind: 'light', id: device.id, on: !readState().on }));

  header.append(back, heading, power);
  panel.append(header);
  const actions = [power];

  let brightnessReadout = null;
  const brightnessPresets = [];
  if (caps.brightness) {
    const section = lightEl(doc, 'div', 'light-section light-brightness');
    section.append(lightEl(doc, 'h3', 'light-section-title', 'Brightness'));
    const controls = lightEl(doc, 'div', 'light-control');
    const minus = lightButton(doc, 'step light-step', 'Decrease brightness');
    minus.append(lightEl(doc, 'span', 'step-sign', '-'));
    const readout = lightEl(doc, 'span', 'light-readout');
    const plus = lightButton(doc, 'step light-step', 'Increase brightness');
    plus.append(lightEl(doc, 'span', 'step-sign', '+'));

    const applyBrightness = (delta) => {
      const state = readState();
      const current = Number.isFinite(state.brightness) ? state.brightness : 0.75;
      const next = Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, Math.round((current + delta) * 100) / 100));
      onAction({ kind: 'lightSet', id: device.id, on: true, brightness: next });
    };
    minus.addEventListener('click', () => applyBrightness(-BRIGHTNESS_STEP));
    plus.addEventListener('click', () => applyBrightness(BRIGHTNESS_STEP));
    controls.append(minus, readout, plus);
    actions.push(minus, plus);

    const presets = lightEl(doc, 'div', 'light-presets');
    for (const value of [0.25, 0.5, 0.75, 1]) {
      const percent = Math.round(value * 100);
      const preset = lightButton(doc, 'light-preset', `Set brightness ${percent}%`);
      preset.dataset.value = String(value);
      preset.setAttribute('data-value', String(value));
      preset.append(lightEl(doc, 'span', '', `${percent}%`));
      preset.addEventListener('click', () => onAction({ kind: 'lightSet', id: device.id, on: true, brightness: value }));
      presets.append(preset);
      brightnessPresets.push(preset);
      actions.push(preset);
    }

    section.append(controls, presets);
    panel.append(section);
    brightnessReadout = readout;
  }

  let tempReadout = null;
  let tempFallback = MID_TEMPERATURE;
  const tempPresets = [];
  if (caps.temp) {
    const minTemp = Number.isFinite(caps.minTemp) ? caps.minTemp : DEFAULT_CAPABILITIES.minTemp;
    const maxTemp = Number.isFinite(caps.maxTemp) ? caps.maxTemp : DEFAULT_CAPABILITIES.maxTemp;
    const low = Math.min(minTemp, maxTemp);
    const high = Math.max(minTemp, maxTemp);
    tempFallback = Math.round((low + high) / 2);
    const standard = KELVIN_PRESETS.filter(kelvin => kelvin >= low && kelvin <= high);
    const values = standard.length ? standard : [...new Set([low, tempFallback, high])];

    const section = lightEl(doc, 'div', 'light-section light-temp');
    section.append(lightEl(doc, 'h3', 'light-section-title', 'Color temperature'));
    const controls = lightEl(doc, 'div', 'light-control');
    const minus = lightButton(doc, 'step light-step', 'Decrease color temperature');
    minus.append(lightEl(doc, 'span', 'step-sign', '-'));
    const readout = lightEl(doc, 'span', 'light-readout');
    const plus = lightButton(doc, 'step light-step', 'Increase color temperature');
    plus.append(lightEl(doc, 'span', 'step-sign', '+'));

    const applyTemp = (delta) => {
      const state = readState();
      const next = Math.min(high, Math.max(low, Math.round(tempOr(state, tempFallback) + delta)));
      onAction({ kind: 'lightSet', id: device.id, on: true, temp: next, color: null });
    };
    minus.addEventListener('click', () => applyTemp(-TEMP_STEP));
    plus.addEventListener('click', () => applyTemp(TEMP_STEP));
    controls.append(minus, readout, plus);
    actions.push(minus, plus);

    const presets = lightEl(doc, 'div', 'light-presets');
    for (const value of values) {
      const preset = lightButton(doc, 'light-preset', `Set color temperature ${value}K`);
      preset.dataset.value = String(value);
      preset.setAttribute('data-value', String(value));
      preset.append(lightEl(doc, 'span', '', `${value}K`));
      preset.addEventListener('click', () => onAction({ kind: 'lightSet', id: device.id, on: true, temp: value, color: null }));
      presets.append(preset);
      tempPresets.push(preset);
      actions.push(preset);
    }

    section.append(controls, presets);
    panel.append(section);
    tempReadout = readout;
  }

  const swatches = [];
  if (caps.color) {
    const section = lightEl(doc, 'div', 'light-section light-color');
    section.append(lightEl(doc, 'h3', 'light-section-title', 'Color'));
    const row = lightEl(doc, 'div', 'color-swatches');
    for (const swatch of COLOR_SWATCHES) {
      const button = lightButton(doc, 'color-swatch', swatch.name);
      button.dataset.color = swatch.hex;
      button.setAttribute('data-color', swatch.hex);
      button.setAttribute('aria-pressed', 'false');
      const dot = lightEl(doc, 'span', 'color-dot');
      dot.style.backgroundColor = swatch.hex;
      button.append(dot);
      button.addEventListener('click', () => onAction({ kind: 'lightSet', id: device.id, on: true, color: swatch.hex }));
      row.append(button);
      swatches.push(button);
      actions.push(button);
    }
    section.append(row);
    panel.append(section);
  }

  if (!caps.brightness && !caps.temp && !caps.color) {
    panel.append(lightEl(doc, 'p', 'sync-note', 'This light supports on/off only.'));
  }

  const sync = (next) => {
    const state = next === undefined ? readState() : (next ?? {});
    title.textContent = state.displayName || device.name || '';
    subtitle.textContent = [roomName, state.on ? 'On' : 'Off', lightStatus(state)].filter(Boolean).join(' · ');

    const on = Boolean(state.on);
    power.setAttribute('aria-pressed', String(on));
    powerLabel.textContent = on ? 'On' : 'Off';
    power.classList.toggle('on', on);

    if (brightnessReadout) {
      const brightness = Number.isFinite(state.brightness) ? state.brightness : 0.75;
      brightnessReadout.textContent = `${Math.round(brightness * 100)}%`;
      const percent = Math.round(brightness * 100);
      for (const preset of brightnessPresets) {
        preset.setAttribute('aria-pressed', String(percent === Math.round(Number(preset.dataset.value) * 100)));
      }
    }

    if (tempReadout) {
      const temp = tempOr(state, tempFallback);
      tempReadout.textContent = `${Math.round(temp)}K`;
      const kelvin = Math.round(temp);
      for (const preset of tempPresets) {
        preset.setAttribute('aria-pressed', String(kelvin === Number(preset.dataset.value)));
      }
    }

    const color = typeof state.color === 'string' ? state.color.toLowerCase() : '';
    for (const swatch of swatches) {
      swatch.setAttribute('aria-pressed', String(color === swatch.dataset.color.toLowerCase()));
    }

    const disabled = !state.controlEnabled;
    for (const button of actions) button.disabled = disabled;
  };

  sync();
  return { panel, sync };
}
