// Unit tests for the D-pad OK repeat guard and the compact light-controls modal.
// A small DOM stub keeps these tests runnable in Node without JSDOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LONG_PRESS_MS,
  COLOR_SWATCHES,
  KELVIN_PRESETS,
  shouldIgnoreDeviceRepeat,
  attachLightRowInput,
  createLightControlsPanel,
} from '../src/webos-light-modal.js';

// --- Minimal DOM stub -------------------------------------------------------

function parseCompound(selector) {
  const parsed = { tag: '', id: '', classes: [], attrs: [] };
  const pattern = /([#.]?[\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  let match;
  while ((match = pattern.exec(selector))) {
    if (match[1]) {
      const token = match[1];
      if (token[0] === '.') parsed.classes.push(token.slice(1));
      else if (token[0] === '#') parsed.id = token.slice(1);
      else parsed.tag = token.toUpperCase();
    } else {
      parsed.attrs.push([match[2], match[3] ?? match[4] ?? match[5] ?? null]);
    }
  }
  return parsed;
}

function matchesCompound(element, selector) {
  const parsed = parseCompound(selector);
  if (parsed.tag && element.tagName !== parsed.tag) return false;
  if (parsed.id && element.id !== parsed.id) return false;
  if (parsed.classes.some(name => !element.classList.contains(name))) return false;
  for (const [name, expected] of parsed.attrs) {
    if (!element.hasAttribute(name)) return false;
    if (expected !== null && element.getAttribute(name) !== expected) return false;
  }
  return true;
}

function splitOutsideBrackets(text, separator) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;
  for (const character of text) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === '[') depth += 1;
    else if (character === ']') depth -= 1;
    if (depth === 0 && character === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

function matchesSelector(element, selector) {
  return splitOutsideBrackets(selector, ',').some(part => {
    const words = splitOutsideBrackets(part.trim(), ' ').filter(Boolean);
    if (!matchesCompound(element, words[words.length - 1])) return false;
    let ancestor = element.parentNode;
    for (let i = words.length - 2; i >= 0; i--) {
      let found = null;
      for (let node = ancestor; node; node = node.parentNode) {
        if (matchesCompound(node, words[i])) {
          found = node;
          break;
        }
      }
      if (!found) return false;
      ancestor = found.parentNode;
    }
    return true;
  });
}

class Element {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.ownerDocument = null;
    this.attributes = Object.create(null);
    this.style = {};
    this.dataset = {};
    this.listeners = new Map();
    this._className = '';
    this._text = '';
    this.id = '';
    this.disabled = false;
    this.hidden = false;
    this.type = '';
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value);
  }

  get classList() {
    const element = this;
    const names = () => element._className.split(/\s+/).filter(Boolean);
    return {
      add: (...added) => { const set = new Set(names()); added.forEach(name => set.add(name)); element._className = [...set].join(' '); },
      remove: (...removed) => { const set = new Set(names()); removed.forEach(name => set.delete(name)); element._className = [...set].join(' '); },
      toggle: (name, force) => {
        const set = new Set(names());
        const on = force === undefined ? !set.has(name) : Boolean(force);
        if (on) set.add(name); else set.delete(name);
        element._className = [...set].join(' ');
        return on;
      },
      contains: name => names().includes(name),
    };
  }

  get textContent() {
    return this._text + this.children.map(child => child?.textContent ?? '').join('');
  }

  set textContent(value) {
    this.children = [];
    this._text = value == null ? '' : String(value);
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node == null) continue;
      if (typeof node === 'string') {
        this._text += node;
        continue;
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }

  setAttribute(name, value) {
    const text = String(value);
    this.attributes[name] = text;
    if (name === 'class') this._className = text;
    if (name === 'id') this.id = text;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = text;
    }
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  hasAttribute(name) {
    return Object.hasOwn(this.attributes, name);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type);
    if (!list) return;
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    const list = this.listeners.get(event.type);
    if (list) for (const listener of [...list]) listener.call(this, event);
    return true;
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (!(child instanceof Element)) continue;
        if (matchesSelector(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
    this.dispatchEvent({ type: 'blur' });
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }
}

function createDocument() {
  const doc = {
    activeElement: null,
    body: null,
    createElement(tagName) {
      const element = new Element(tagName);
      element.ownerDocument = doc;
      return element;
    },
    createTextNode(text) {
      return { textContent: String(text) };
    },
  };
  doc.body = doc.createElement('body');
  return doc;
}

// --- Event and timer doubles ----------------------------------------------

function keyEvent(type, init = {}) {
  return {
    type,
    key: '',
    keyCode: 0,
    repeat: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...init,
  };
}

function pointerEvent(type, init = {}) {
  return { type, button: 0, isPrimary: true, ...init };
}

function fakeTimers() {
  const pending = [];
  return {
    setTimer(callback) {
      const timer = { callback, cancelled: false };
      pending.push(timer);
      return timer;
    },
    clearTimer(timer) {
      if (timer) timer.cancelled = true;
    },
    fire() {
      for (const timer of pending) {
        if (timer.cancelled) continue;
        timer.cancelled = true;
        timer.callback();
      }
    },
    get remaining() {
      return pending.filter(timer => !timer.cancelled).length;
    },
  };
}

function attachHarness(button, longPressMs = 100) {
  const timers = fakeTimers();
  let toggles = 0;
  let longPresses = 0;
  const detach = attachLightRowInput(button, {
    onToggle: () => { toggles += 1; },
    onLongPress: () => { longPresses += 1; },
    longPressMs,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return {
    detach,
    timers,
    get toggles() {
      return toggles;
    },
    get longPresses() {
      return longPresses;
    },
  };
}

function buildPanel(state, extra = {}) {
  const doc = createDocument();
  const actions = [];
  let closed = 0;
  const built = createLightControlsPanel({
    device: { id: 'light.demo', name: 'Ceiling' },
    getState: () => state,
    roomName: 'Studio',
    onAction: action => actions.push(action),
    onClose: () => { closed += 1; },
    document: doc,
    ...extra,
  });
  return {
    doc,
    actions,
    panel: built.panel,
    sync: built.sync,
    get closed() {
      return closed;
    },
  };
}

const texts = nodes => nodes.map(node => node.textContent);

// --- Repeat guard -----------------------------------------------------------

test('shouldIgnoreDeviceRepeat drops held OK/Space on device controls only', () => {
  assert.equal(LONG_PRESS_MS, 450);
  const doc = createDocument();
  const row = doc.createElement('button');
  row.className = 'light-row';
  const power = doc.createElement('button');
  power.className = 'power';
  const step = doc.createElement('button');
  step.className = 'step';
  const scene = doc.createElement('button');
  scene.className = 'scene-button';
  const allOff = doc.createElement('button');
  allOff.id = 'all-off';
  const plain = doc.createElement('div');

  for (const [name, element] of [['.light-row', row], ['.power', power], ['.step', step], ['.scene-button', scene], ['#all-off', allOff]]) {
    assert.equal(shouldIgnoreDeviceRepeat(keyEvent('keydown', { key: 'Enter', repeat: true, target: element })), true, `${name} Enter`);
    assert.equal(shouldIgnoreDeviceRepeat(keyEvent('keydown', { key: ' ', repeat: true, target: element })), true, `${name} Space`);
    assert.equal(shouldIgnoreDeviceRepeat(keyEvent('keydown', { keyCode: 13, repeat: true, target: element })), true, `${name} keyCode 13`);
  }

  assert.equal(shouldIgnoreDeviceRepeat(keyEvent('keydown', { key: 'Enter', repeat: false, target: row })), false, 'non-repeat');
  assert.equal(shouldIgnoreDeviceRepeat(keyEvent('keydown', { key: 'ArrowDown', repeat: true, target: row })), false, 'arrow');
  assert.equal(shouldIgnoreDeviceRepeat(keyEvent('keydown', { key: 'Escape', repeat: true, target: row })), false, 'back');
  assert.equal(shouldIgnoreDeviceRepeat(keyEvent('keydown', { key: 'Enter', repeat: true, target: plain })), false, 'not a device control');

  const previous = globalThis.document;
  globalThis.document = { activeElement: row };
  try {
    assert.equal(shouldIgnoreDeviceRepeat({ repeat: true, key: 'Enter' }), true, 'falls back to document.activeElement');
  } finally {
    globalThis.document = previous;
  }
});

// --- Button input handling --------------------------------------------------

test('held OK with repeats toggles once on release, before the long-press threshold', () => {
  const doc = createDocument();
  const button = doc.createElement('button');
  const harness = attachHarness(button, 100);

  const initial = keyEvent('keydown', { key: 'Enter', target: button });
  button.dispatchEvent(initial);
  assert.equal(initial.defaultPrevented, true);

  for (let index = 0; index < 10; index++) {
    const repeat = keyEvent('keydown', { key: 'Enter', repeat: true, target: button });
    button.dispatchEvent(repeat);
    assert.equal(repeat.defaultPrevented, true);
  }
  assert.equal(harness.toggles, 0, 'repeats never toggle');
  assert.equal(harness.longPresses, 0, 'release arrives before the hold threshold');
  assert.equal(harness.timers.remaining, 1);

  button.dispatchEvent(keyEvent('keyup', { key: 'Enter' }));
  assert.equal(harness.toggles, 1, 'one toggle on release');
  assert.equal(harness.longPresses, 0);
  harness.detach();
});

test('holding OK past the long-press threshold opens controls and suppresses the toggle', () => {
  const doc = createDocument();
  const button = doc.createElement('button');
  const harness = attachHarness(button, 100);

  button.dispatchEvent(keyEvent('keydown', { key: 'Enter', target: button }));
  harness.timers.fire();

  assert.equal(harness.longPresses, 1);
  assert.equal(harness.toggles, 0);
  assert.equal(harness.timers.remaining, 0, 'the fired hold timer is done');

  button.dispatchEvent(keyEvent('keyup', { key: 'Enter' }));
  assert.equal(harness.longPresses, 1, 'no second long press');
  assert.equal(harness.toggles, 0, 'release after a long press does not toggle');
  harness.detach();
});

test('blur or Back before the long-press threshold cancels the hold without toggling', () => {
  for (const cancel of ['blur', 'escape']) {
    const doc = createDocument();
    const button = doc.createElement('button');
    const harness = attachHarness(button, 100);

    button.dispatchEvent(keyEvent('keydown', { key: 'Enter', target: button }));
    if (cancel === 'blur') button.dispatchEvent({ type: 'blur' });
    else button.dispatchEvent(keyEvent('keydown', { key: 'Escape', target: button }));

    harness.timers.fire();
    button.dispatchEvent(keyEvent('keyup', { key: 'Enter' }));
    assert.equal(harness.longPresses, 0, `${cancel} cancels the hold timer`);
    assert.equal(harness.toggles, 0, `${cancel} prevents the toggle`);
    harness.detach();
  }
});

test('normal clicks toggle once and pointer long-press swallows the trailing click', () => {
  const doc = createDocument();
  const button = doc.createElement('button');
  const harness = attachHarness(button, 100);

  button.dispatchEvent({ type: 'click' });
  assert.equal(harness.toggles, 1);
  assert.equal(harness.longPresses, 0);

  button.dispatchEvent(pointerEvent('pointerdown'));
  harness.timers.fire();
  button.dispatchEvent(pointerEvent('pointerup'));
  button.dispatchEvent({ type: 'click' });

  assert.equal(harness.longPresses, 1, 'pointer hold reaches the threshold');
  assert.equal(harness.toggles, 1, 'the trailing click is suppressed');

  button.dispatchEvent(pointerEvent('pointerdown', { button: 2 }));
  harness.timers.fire();
  assert.equal(harness.longPresses, 1, 'non-primary pointer buttons are ignored');

  button.dispatchEvent(pointerEvent('pointerdown', { isPrimary: false }));
  harness.timers.fire();
  assert.equal(harness.longPresses, 1, 'non-primary pointers are ignored');

  button.dispatchEvent(pointerEvent('pointerdown'));
  button.dispatchEvent(pointerEvent('pointerleave'));
  harness.timers.fire();
  assert.equal(harness.longPresses, 1, 'pointer leave cancels the hold timer');
  harness.detach();
});

test('detach removes listeners and clears pending timers', () => {
  const doc = createDocument();
  const button = doc.createElement('button');
  const harness = attachHarness(button, 100);

  button.dispatchEvent(keyEvent('keydown', { key: 'Enter', target: button }));
  harness.detach();
  assert.equal(harness.timers.remaining, 0);

  button.dispatchEvent(keyEvent('keyup', { key: 'Enter' }));
  button.dispatchEvent({ type: 'click' });
  assert.equal(harness.toggles, 0);
  assert.equal(harness.longPresses, 0);
});

// --- Capability matrix ------------------------------------------------------

test('light modal renders exactly the supported control sections', () => {
  const base = { on: true, controlEnabled: true, status: 'simulated', displayName: 'Ceiling' };
  const cases = [
    ['onoff', { brightness: false, temp: false, color: false }, [false, false, false]],
    ['brightness', { brightness: true, temp: false, color: false }, [true, false, false]],
    ['color_temp', { brightness: true, temp: true, color: false, minTemp: 2500, maxTemp: 4500 }, [true, true, false]],
    ['rgb', { brightness: true, temp: false, color: true }, [true, false, true]],
    ['color_temp + rgb', { brightness: true, temp: true, color: true }, [true, true, true]],
  ];

  for (const [name, capabilities, [brightness, temp, color]] of cases) {
    const ui = buildPanel({ ...base, capabilities });
    assert.equal(Boolean(ui.panel.querySelector('.light-brightness')), brightness, `${name}: brightness section`);
    assert.equal(Boolean(ui.panel.querySelector('.light-temp')), temp, `${name}: temperature section`);
    assert.equal(Boolean(ui.panel.querySelector('.light-color')), color, `${name}: color section`);
    assert.equal(Boolean(ui.panel.querySelector('.sync-note')), !brightness && !temp && !color, `${name}: on/off note`);
  }

  const notePanel = buildPanel({ ...base, capabilities: { brightness: false, temp: false, color: false } }).panel;
  assert.equal(notePanel.querySelector('.sync-note').textContent, 'This light supports on/off only.');
});

test('temperature presets stay inside capability bounds and fall back to min/mid/max', () => {
  const caps = { brightness: true, temp: true, color: false };
  const bounded = buildPanel({ on: true, controlEnabled: true, temp: 4000, capabilities: { ...caps, minTemp: 2500, maxTemp: 4500 } });
  assert.deepEqual(texts(bounded.panel.querySelectorAll('.light-temp .light-preset')), ['2700K', '3200K', '4000K']);

  const narrow = buildPanel({ on: true, controlEnabled: true, temp: 1050, capabilities: { ...caps, minTemp: 1000, maxTemp: 1100 } });
  assert.deepEqual(texts(narrow.panel.querySelectorAll('.light-temp .light-preset')), ['1000K', '1050K', '1100K']);
});

test('the panel exposes the curated swatches and Kelvin presets', () => {
  assert.deepEqual(COLOR_SWATCHES.map(swatch => swatch.hex), ['#ff9f43', '#ff4d4f', '#ff6b9d', '#a855f7', '#3b82f6', '#06b6d4', '#22c55e']);
  assert.deepEqual(KELVIN_PRESETS, [2700, 3200, 4000, 5000, 6500]);

  const ui = buildPanel({ on: true, controlEnabled: true, color: '#3b82f6', capabilities: { brightness: false, temp: false, color: true } });
  const swatches = ui.panel.querySelectorAll('.color-swatch');
  assert.equal(swatches.length, COLOR_SWATCHES.length);
  swatches.forEach((swatch, index) => {
    assert.equal(swatch.dataset.color, COLOR_SWATCHES[index].hex);
    assert.equal(swatch.getAttribute('aria-label'), COLOR_SWATCHES[index].name);
    const dot = swatch.querySelector('.color-dot');
    assert.equal(dot.style.backgroundColor, COLOR_SWATCHES[index].hex);
  });
});

// --- Action payloads --------------------------------------------------------

test('power, brightness, temperature and color controls emit exact action payloads', () => {
  const state = {
    on: true,
    brightness: 0.75,
    temp: 4000,
    color: null,
    controlEnabled: true,
    capabilities: { brightness: true, temp: true, color: true, minTemp: 2500, maxTemp: 4500 },
  };
  const ui = buildPanel(state);

  ui.panel.querySelector('[aria-label="Toggle power"]').dispatchEvent({ type: 'click' });
  assert.deepEqual(ui.actions.at(-1), { kind: 'light', id: 'light.demo', on: false });

  const brightnessSteps = ui.panel.querySelectorAll('.light-brightness .step');
  assert.equal(brightnessSteps.length, 2);
  assert.deepEqual(texts(ui.panel.querySelectorAll('.light-brightness .light-preset')), ['25%', '50%', '75%', '100%']);
  assert.equal(ui.panel.querySelector('.light-brightness .light-readout').textContent, '75%');

  brightnessSteps[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(ui.actions.at(-1), { kind: 'lightSet', id: 'light.demo', on: true, brightness: 0.65 });

  brightnessSteps[1].dispatchEvent({ type: 'click' });
  assert.deepEqual(ui.actions.at(-1), { kind: 'lightSet', id: 'light.demo', on: true, brightness: 0.85 });

  ui.panel.querySelectorAll('.light-brightness .light-preset')[3].dispatchEvent({ type: 'click' });
  assert.deepEqual(ui.actions.at(-1), { kind: 'lightSet', id: 'light.demo', on: true, brightness: 1 });

  const tempSteps = ui.panel.querySelectorAll('.light-temp .step');
  tempSteps[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(ui.actions.at(-1), { kind: 'lightSet', id: 'light.demo', on: true, temp: 3700, color: null });

  tempSteps[1].dispatchEvent({ type: 'click' });
  assert.deepEqual(ui.actions.at(-1), { kind: 'lightSet', id: 'light.demo', on: true, temp: 4300, color: null });

  ui.panel.querySelectorAll('.light-temp .light-preset')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(ui.actions.at(-1), { kind: 'lightSet', id: 'light.demo', on: true, temp: 2700, color: null });

  ui.panel.querySelectorAll('.color-swatch')[2].dispatchEvent({ type: 'click' });
  assert.deepEqual(ui.actions.at(-1), { kind: 'lightSet', id: 'light.demo', on: true, color: '#ff6b9d' });
});

test('brightness and temperature steps clamp to their allowed ranges', () => {
  const lowBrightness = buildPanel({ on: true, controlEnabled: true, brightness: 0.03, capabilities: { brightness: true, temp: false, color: false } });
  lowBrightness.panel.querySelectorAll('.light-brightness .step')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(lowBrightness.actions.at(-1), { kind: 'lightSet', id: 'light.demo', on: true, brightness: 0.05 });

  const highBrightness = buildPanel({ on: true, controlEnabled: true, brightness: 0.98, capabilities: { brightness: true, temp: false, color: false } });
  highBrightness.panel.querySelectorAll('.light-brightness .step')[1].dispatchEvent({ type: 'click' });
  assert.deepEqual(highBrightness.actions.at(-1), { kind: 'lightSet', id: 'light.demo', on: true, brightness: 1 });

  const caps = { brightness: true, temp: true, color: false, minTemp: 2500, maxTemp: 4500 };
  const lowTemp = buildPanel({ on: true, controlEnabled: true, temp: 2600, capabilities: caps });
  lowTemp.panel.querySelectorAll('.light-temp .step')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(lowTemp.actions.at(-1), { kind: 'lightSet', id: 'light.demo', on: true, temp: 2500, color: null });

  const highTemp = buildPanel({ on: true, controlEnabled: true, temp: 4400, capabilities: caps });
  highTemp.panel.querySelectorAll('.light-temp .step')[1].dispatchEvent({ type: 'click' });
  assert.deepEqual(highTemp.actions.at(-1), { kind: 'lightSet', id: 'light.demo', on: true, temp: 4500, color: null });
});

// --- Sync -------------------------------------------------------------------

test('sync refreshes identity, readouts, active presets and disabled controls', () => {
  const state = {
    displayName: 'Pieza',
    on: true,
    brightness: 0.5,
    temp: 4000,
    color: '#ff9f43',
    status: 'simulated',
    controlEnabled: true,
    capabilities: { brightness: true, temp: true, color: true, minTemp: 2500, maxTemp: 4500 },
  };
  const ui = buildPanel(state);

  assert.equal(ui.panel.querySelector('h2').textContent, 'Pieza');
  assert.match(ui.panel.querySelector('.light-modal-subtitle').textContent, /Studio · On/);
  assert.equal(ui.panel.querySelector('[aria-label="Toggle power"]').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.panel.querySelector('[aria-label="Toggle power"]').textContent, 'On');
  assert.equal(ui.panel.querySelector('.light-brightness .light-readout').textContent, '50%');
  assert.equal(ui.panel.querySelector('.light-temp .light-readout').textContent, '4000K');

  state.displayName = 'Bed lamp';
  state.on = false;
  state.brightness = 0.25;
  state.temp = 2700;
  state.color = '#3b82f6';
  state.status = 'unavailable';
  state.controlEnabled = false;

  ui.sync();

  assert.equal(ui.panel.querySelector('h2').textContent, 'Bed lamp');
  assert.match(ui.panel.querySelector('.light-modal-subtitle').textContent, /Studio · Off · Unavailable/);
  assert.equal(ui.panel.querySelector('[aria-label="Toggle power"]').getAttribute('aria-pressed'), 'false');
  assert.equal(ui.panel.querySelector('[aria-label="Toggle power"]').textContent, 'Off');
  assert.equal(ui.panel.querySelector('.light-brightness .light-readout').textContent, '25%');
  assert.equal(ui.panel.querySelector('.light-temp .light-readout').textContent, '2700K');

  const brightnessPresets = ui.panel.querySelectorAll('.light-brightness .light-preset');
  assert.equal(brightnessPresets[0].getAttribute('aria-pressed'), 'true');
  assert.equal(brightnessPresets[1].getAttribute('aria-pressed'), 'false');

  const tempPresets = ui.panel.querySelectorAll('.light-temp .light-preset');
  assert.equal(tempPresets[0].getAttribute('aria-pressed'), 'true');
  assert.equal(tempPresets[1].getAttribute('aria-pressed'), 'false');

  const swatches = ui.panel.querySelectorAll('.color-swatch');
  assert.equal(swatches[0].getAttribute('aria-pressed'), 'false');
  assert.equal(swatches[4].getAttribute('aria-pressed'), 'true');

  const buttons = ui.panel.querySelectorAll('button');
  assert.ok(buttons.length > 2);
  for (const button of buttons) {
    if (button.getAttribute('aria-label') === 'Back') assert.equal(button.disabled, false, 'Back stays enabled');
    else assert.equal(button.disabled, true, `${button.getAttribute('aria-label')} disabled`);
  }
});

test('sync accepts an explicit state and the Back button closes the modal', () => {
  const state = { on: false, controlEnabled: true, capabilities: { brightness: false, temp: false, color: false } };
  const ui = buildPanel(state);

  ui.sync({ displayName: 'Lamp', on: true, controlEnabled: true });
  assert.equal(ui.panel.querySelector('h2').textContent, 'Lamp');
  assert.equal(ui.panel.querySelector('[aria-label="Toggle power"]').getAttribute('aria-pressed'), 'true');

  ui.panel.querySelector('[aria-label="Back"]').dispatchEvent({ type: 'click' });
  assert.equal(ui.closed, 1);
});
