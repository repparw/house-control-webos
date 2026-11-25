import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPEARANCE_LABELS,
  APPEARANCE_MODES,
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  createAppearanceSelector,
  getAppearanceMode,
  normalizeAppearanceMode,
  resolveAppearance,
  setAppearanceMode,
} from '../src/webos-theme.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    if (force === undefined) {
      if (this.values.has(name)) this.values.delete(name);
      else this.values.add(name);
      return this.values.has(name);
    }
    if (force) this.values.add(name);
    else this.values.delete(name);
    return force;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.textContent = '';
  }

  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name === 'class') {
      this.classList = new FakeClassList();
      for (const item of text.split(/\s+/).filter(Boolean)) this.classList.add(item);
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement('html', this);
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
    this.documentElement.append(this.head, this.body);
    this.themeColor = new FakeElement('meta', this);
    this.themeColor.setAttribute('name', 'theme-color');
    this.themeColor.setAttribute('content', '#000000');
    this.head.append(this.themeColor);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  querySelector(selector) {
    if (selector !== 'meta[name="theme-color"]') return null;
    return this.themeColor;
  }
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test('appearance modes and labels are stable', () => {
  assert.deepEqual(APPEARANCE_MODES, ['oled', 'light', 'auto']);
  assert.equal(Object.isFrozen(APPEARANCE_MODES), true);
  assert.equal(APPEARANCE_STORAGE_KEY, 'house-control:webos:theme:v1');
  assert.deepEqual(APPEARANCE_LABELS, {
    oled: 'OLED Dark',
    light: 'Light',
    auto: 'Auto',
  });
  assert.equal(normalizeAppearanceMode('unknown'), 'oled');
  assert.equal(normalizeAppearanceMode(null), 'oled');
});

test('appearance mode defaults to OLED Dark for empty or invalid storage', () => {
  assert.equal(getAppearanceMode(memoryStorage()), 'oled');
  assert.equal(getAppearanceMode(memoryStorage({ [APPEARANCE_STORAGE_KEY]: 'invalid' })), 'oled');
});

test('appearance mode persists all supported choices', () => {
  for (const mode of APPEARANCE_MODES) {
    const storage = memoryStorage();
    assert.equal(setAppearanceMode(mode, storage), mode);
    assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY), mode);
    assert.equal(getAppearanceMode(storage), mode);
  }
});

test('appearance storage failures are tolerated', () => {
  const storage = {
    getItem() {
      throw new Error('unavailable');
    },
    setItem() {
      throw new Error('unavailable');
    },
  };

  assert.equal(setAppearanceMode('light', storage), 'light');
  assert.equal(getAppearanceMode(storage), 'oled');
});

test('appearance resolution covers every mode and system preference', () => {
  assert.equal(resolveAppearance('oled', false), 'oled');
  assert.equal(resolveAppearance('oled', true), 'oled');
  assert.equal(resolveAppearance('light', false), 'day');
  assert.equal(resolveAppearance('light', true), 'day');
  assert.equal(resolveAppearance('auto', false), 'oled');
  assert.equal(resolveAppearance('auto', true), 'day');
});

test('appearance application updates the document and world', () => {
  const document = new FakeDocument();
  const calls = [];
  const world = {
    setDaylight(day, instant) {
      calls.push([day, instant]);
    },
  };

  assert.deepEqual(applyAppearance({
    mode: 'oled',
    world,
    document,
    matchMedia: () => ({ matches: false }),
  }), { mode: 'oled', theme: 'oled', day: false });
  assert.equal(document.documentElement.dataset.theme, 'oled');
  assert.equal(document.documentElement.dataset.appearance, 'oled');
  assert.equal(document.themeColor.getAttribute('content'), '#000000');
  assert.deepEqual(calls, [[false, false]]);

  assert.deepEqual(applyAppearance({
    mode: 'light',
    world,
    document,
    matchMedia: () => ({ matches: false }),
  }), { mode: 'light', theme: 'day', day: true });
  assert.equal(document.documentElement.dataset.theme, 'day');
  assert.equal(document.documentElement.dataset.appearance, 'light');
  assert.equal(document.themeColor.getAttribute('content'), '#e9eaed');
  assert.deepEqual(calls.at(-1), [true, false]);

  applyAppearance({
    mode: 'auto',
    world,
    document,
    matchMedia: () => ({ matches: true }),
    instant: true,
  });
  assert.equal(document.documentElement.dataset.theme, 'day');
  assert.equal(document.documentElement.dataset.appearance, 'auto');
  assert.equal(document.themeColor.getAttribute('content'), '#e9eaed');
  assert.deepEqual(calls.at(-1), [true, true]);
});

test('appearance selector renders, changes, and synchronizes', () => {
  const document = new FakeDocument();
  const changes = [];
  const selector = createAppearanceSelector({
    mode: 'light',
    onChange: mode => changes.push(mode),
    document,
  });

  assert.equal(selector.element.className, 'appearance-control');
  assert.equal(selector.element.getAttribute('role'), 'group');
  assert.equal(selector.element.getAttribute('aria-label'), 'Appearance');

  const options = selector.element.children[0];
  assert.equal(options.className, 'device-filters appearance-options');
  assert.equal(options.children.length, 3);
  assert.deepEqual(options.children.map(button => button.textContent), ['OLED Dark', 'Light', 'Auto']);
  assert.deepEqual(options.children.map(button => button.dataset.appearance), ['oled', 'light', 'auto']);
  assert.deepEqual(options.children.map(button => button.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.deepEqual(options.children.map(button => button.classList.contains('selected')), [false, true, false]);

  options.children[0].click();
  assert.deepEqual(changes, ['oled']);
  assert.deepEqual(options.children.map(button => button.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  assert.deepEqual(options.children.map(button => button.classList.contains('selected')), [true, false, false]);

  selector.sync('auto');
  assert.deepEqual(options.children.map(button => button.getAttribute('aria-pressed')), ['false', 'false', 'true']);
  assert.deepEqual(options.children.map(button => button.classList.contains('selected')), [false, false, true]);
});
