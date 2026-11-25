import './style.css';
import { createHACredentialStore } from './webos-credentials.js';
import { createHASetupForm } from './webos-setup.js';
import { createElement, House, Settings2, ChevronLeft, ChevronRight, Lightbulb, Power, Minus, Plus, Snowflake, Sun, Moon, Sofa, Film, DoorOpen, Wifi, Rotate3d, Check, ArrowLeft, Smartphone, RefreshCw, Info, HandHeart } from 'lucide';
import QRCode from 'qrcode';
import { normalize } from '@house-control/visuals';
import { createWorld } from './vendor/three/world.js';
import { api } from './api.js';
import { ABOUT, SUPPORT_INTRO, SUPPORT_LINKS } from './support.js';

const credentials = createHACredentialStore();
const app = document.querySelector('#app');
const $ = (s) => document.querySelector(s);
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
const icons = { House, Settings2, Lightbulb, Power, Snowflake, Sun, Moon, Sofa, Film, DoorOpen, Wifi, Rotate3d, Check, ArrowLeft, Smartphone, RefreshCw, Minus, Plus, ChevronLeft, ChevronRight, Info, HandHeart };
function icon(name, size = 24) { return createElement(icons[name] || House, { width: size, height: size, 'stroke-width': 1.65 }); }
function button(label, name, action, cls = '') {
  const b = el('button', cls); b.type = 'button'; b.setAttribute('aria-label', label);
  if (name) b.append(icon(name)); if (label) b.append(el('span', '', label)); b.onclick = action; return b;
}
const modes = { cool: 'Cooling', heat: 'Heating', auto: 'Auto', dry: 'Dry', fan: 'Fan' };
let config, bundle, world, resizeObserver, deviceKind = 'lights', room = 'all', online = false, busy = false, orbiting = false, modal = null, lastFocus = null;
let store = { state: { lights: {}, acs: {}, scene: null }, listeners: new Set(), on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); } };
let lightNodes = new Map(), acNodes = new Map(), sceneNodes = new Map();
let toastTimer, reportedOperation;
// Small TV chips (2 GB, 4 cores) draw the 3D view at a lower internal resolution; the UI stays sharp.
const RES = (navigator.deviceMemory || 4) <= 2 || (navigator.hardwareConcurrency || 8) <= 4 ? 0.62 : 1;
function toast(message) { const n = $('#toast'); if (!n) return; n.textContent = message; n.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => n.classList.remove('visible'), 4500); }
function emit() { for (const fn of store.listeners) fn({ type: 'bulk', remote: true }); }
function apply(next) {
  bundle = next; online = !!(next.controlReady ?? next.macOnline);
  const changed = JSON.stringify(store.state) !== JSON.stringify(next.state);
  store.state = structuredClone(next.state); if (changed) emit(); update();
  const op = next.operation;
  if (op?.finishedAt && op.failed && op.id !== reportedOperation) {
    reportedOperation = op.id;
    toast([op.message, ...op.failures.map(f => f.name + ': ' + f.message)].join(' · '));
  }
}
async function command(action) {
  if (busy) return;
  busy = true; app.classList.add('pending');
  try {
    const result = await api('/api/action', action);
    apply(result.home);
  } catch (error) { toast(error.message); }
  finally { busy = false; app.classList.remove('pending'); }
}
function deviceStatus(s) {
  if (s.pending) return 'Pending';
  return s.error || ({ stale: 'Last known', unavailable: 'Unavailable', disconnected: 'Offline', unsupported: 'Unsupported', invalid: 'Invalid entity' })[s.status];
}
function roomName(id) { return config.rooms.find(r => r.id === id)?.name || ''; }
function selectRoom(id) {
  room = id; world?.focus(id === 'all' ? null : { kind: 'room', id });
  for (const b of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-room]'))) {
    const selected = b.dataset.room === id;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', String(selected));
  }
  $('#room-title').textContent = id === 'all' ? 'Whole home' : roomName(id);
  renderDevices(); update();
}
function renderDevices() {
  const list = $('#device-list'); list.replaceChildren(); lightNodes.clear(); acNodes.clear();
  const lights = config.lights.filter(d => deviceKind === 'lights' && (room === 'all' || d.room === room));
  const acs = config.acs.filter(d => deviceKind === 'acs' && (room === 'all' || d.room === room));
  for (const b of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-kind]'))) {
    b.classList.toggle('selected', b.dataset.kind === deviceKind);
    b.setAttribute('aria-pressed', String(b.dataset.kind === deviceKind));
  }
  $('#device-count').textContent = String(lights.length + acs.length);
  $('#all-off').hidden = deviceKind !== 'lights';
  if (!lights.length && !acs.length) list.append(el('p', 'empty', 'No devices in this category. Try another room or import an updated floor plan.'));
  for (const d of acs) {
    const card = el('section', 'climate-card');
    const top = el('div', 'climate-top');
    const title = el('div', 'device-title'); title.append(el('span', 'device-room', roomName(d.room)), el('h3', '', d.name));
    const power = button('Air conditioner power', 'Power', () => command({ kind: 'acPower', id: d.id, on: !store.state.acs[d.id].on }), 'power icon-button');
    top.append(title, power);
    const dial = el('div', 'climate-dial');
    const minus = button('Lower temperature', 'Minus', () => { const n = store.state.acs[d.id].target; if (n > d.min) command({ kind: 'acTarget', id: d.id, target: n - 1 }); }, 'step icon-button');
    const target = el('div', 'temperature');
    const plus = button('Raise temperature', 'Plus', () => { const n = store.state.acs[d.id].target; if (n < d.max) command({ kind: 'acTarget', id: d.id, target: n + 1 }); }, 'step icon-button');
    dial.append(minus, target, plus);
    const info = el('div', 'climate-info'); const mode = el('span'); const current = el('span'); info.append(mode, current);
    card.append(top, dial, info); list.append(card); acNodes.set(d.id, { card, power, target, mode, current, minus, plus });
  }
  for (const d of lights) {
    const b = el('button', 'light-row'); b.type = 'button';
    const lamp = el('span', 'light-icon'); lamp.append(icon('Lightbulb'));
    const title = el('span', 'light-title'); const name = el('strong', '', d.name); const detail = el('small'); title.append(name, detail);
    const toggle = el('span', 'toggle'); toggle.append(el('i'));
    b.append(lamp, title, toggle); b.onclick = () => command({ kind: 'light', id: d.id, on: !store.state.lights[d.id].on });
    // On small TV chips the 3D lamp highlight would redraw the model on every move; keep focus instant there.
    b.onfocus = () => { const u = world?.lights.get(d.id); if (u && RES === 1) { u.hoverGoal = 1; world.setRunning(true); } };
    b.onblur = () => { const u = world?.lights.get(d.id); if (u && RES === 1) { u.hoverGoal = 0; world.setRunning(true); } };
    list.append(b); lightNodes.set(d.id, { b, detail, name, lamp });
  }
}
function update() {
  if (!config || !$('#status')) return;
  const on = Object.values(store.state.lights).filter(s => s.on).length;
  if (bundle?.connection) {
    $('#status').textContent = bundle.connection.label;
    const settings = bundle.connection.connected || bundle.connection.reconnecting;
    const control = $('.sync-button');
    const label = settings ? 'Settings' : 'Sync & connect';
    if (control.getAttribute('aria-label') !== label) {
      control.setAttribute('aria-label', label);
      control.replaceChildren(icon(settings ? 'Settings2' : 'Smartphone'), el('span', '', label));
    }
  } else {
    $('#status').textContent = 'Demo · no real devices';
  }
  $('#status').classList.toggle('offline', !online);
  const acOn = Object.values(store.state.acs).filter(s => s.on).length;
  const sceneName = config.scenes.find(s => s.id === store.state.scene)?.name;
  const parts = [on ? `${on} of ${config.lights.length} lights on` : 'All lights off'];
  if (config.acs.length) parts.push(acOn ? `${acOn} AC running` : 'Climate off');
  if (sceneName) parts.push(sceneName);
  $('#summary').textContent = parts.join('  ·  ');
  for (const [id, n] of lightNodes) {
    const s = store.state.lights[id]; if (!s) continue;
    n.b.classList.toggle('on', s.on); n.b.setAttribute('aria-pressed', String(s.on));
    const device = config.lights.find(d => d.id === id);
    const name = s.displayName || device.name;
    n.name.textContent = name;
    n.b.setAttribute('aria-label', `${name}, ${s.on ? 'on' : 'off'}`);
    n.detail.textContent = (room === 'all' ? roomName(device.room) + ' · ' : '') + (s.on ? 'On' : 'Off');
    const status = deviceStatus(s);
    if (status) n.detail.textContent += ' · ' + status;
    n.b.disabled = !s.controlEnabled;
  }
  for (const [id, n] of acNodes) {
    const s = store.state.acs[id]; if (!s) continue;
    const d = config.acs.find(d => d.id === id);
    n.card.classList.toggle('on', s.on); n.power.setAttribute('aria-pressed', String(s.on));
    n.target.replaceChildren(document.createTextNode(s.target), el('span', '', '°'));
    n.mode.textContent = s.on ? modes[s.mode] || s.mode : 'Off';
    n.current.textContent = Number.isFinite(s.roomTemp) ? `${Math.round(s.roomTemp * 10) / 10}° in room` : 'No sensor';
    const status = deviceStatus(s);
    if (status) n.mode.textContent += ' · ' + status;
    const disabled = !s.controlEnabled;
    n.power.disabled = disabled; n.minus.disabled = disabled || s.target <= d.min; n.plus.disabled = disabled || s.target >= d.max;
  }
  for (const [id, b] of sceneNodes) { b.classList.toggle('active', id === store.state.scene); b.setAttribute('aria-pressed', id === store.state.scene); b.disabled = false; }
  $('#all-off').disabled = false;
}
function sceneIcon(s) { return ({ sun: 'Sun', sofa: 'Sofa', film: 'Film', moon: 'Moon', door: 'DoorOpen' })[s.icon] || 'Sun'; }
function render() {
  app.replaceChildren(); sceneNodes.clear();
  const header = el('header');
  const brand = el('div', 'brand'); const logo = el('span', 'logo'); logo.append(icon('House', 28));
  const brandText = el('div'); brandText.append(el('strong', '', 'House Control')); brand.append(logo, brandText);
  const tabs = el('nav', 'rooms'); tabs.setAttribute('aria-label', 'Rooms');
  for (const r of [{ id: 'all', name: 'Whole home' }, ...config.rooms]) {
    const b = button(r.name, null, () => selectRoom(r.id), 'room-tab'); b.dataset.room = r.id; b.classList.toggle('selected', r.id === room); b.setAttribute('aria-pressed', r.id === room); tabs.append(b);
  }
  const connection = el('div', 'connection');
  const clock = el('time'); clock.id = 'clock';
  connection.append(clock, button('Sync & connect', 'Smartphone', openSettings, 'sync-button'));
  header.append(brand, tabs, connection);
  const layout = el('main', 'layout');
  const stage = el('section', 'stage');
  const caption = el('div', 'stage-caption');
  const title = el('h1', '', 'Whole home'); title.id = 'room-title';
  const summary = el('p', 'summary'); summary.id = 'summary';
  const status = el('p'); status.id = 'status';
  caption.append(title, summary, status);
  const canvas = el('canvas'); canvas.id = 'world'; canvas.setAttribute('aria-label', 'Interactive 3D home model');
  const orbit = button('Explore in 3D', 'Rotate3d', () => { orbiting = !orbiting; orbit.classList.toggle('active', orbiting); toast(orbiting ? 'Arrow keys rotate the model · OK or Back to finish' : 'Remote navigation'); }, 'orbit-button'); orbit.id = 'orbit';
  stage.append(canvas, caption, orbit);
  const aside = el('aside', 'controls'); const heading = el('div', 'controls-heading'); const count = el('span'); count.id = 'device-count'; heading.append(el('h2', '', 'Devices'), count);
  const off = button('Lights off', 'Power', () => command({ kind: room === 'all' ? 'allLights' : 'room', ...(room === 'all' ? {} : { id: room }), on: false }), 'all-off'); off.id = 'all-off';
  const filters = el('div', 'device-filters');
  for (const [kind, label, name] of [['lights', 'Lighting', 'Lightbulb'], ['acs', 'Climate', 'Snowflake']]) {
    const b = button(label, name, () => { deviceKind = kind; renderDevices(); update(); }, 'device-filter'); b.dataset.kind = kind; filters.append(b);
  }
  const list = el('div', 'device-list'); list.id = 'device-list'; aside.append(heading, filters, off, list);
  layout.append(stage, aside);
  const scenes = el('section', 'scenes'); const sceneTitle = el('div', 'scene-heading'); sceneTitle.append(el('h2', '', 'Scenes'));
  const sceneList = el('div', 'scene-list');
  for (const s of config.scenes) { const b = button(s.name, sceneIcon(s), () => command({ kind: 'scene', id: s.id }), 'scene-button'); sceneList.append(b); sceneNodes.set(s.id, b); }
  if (!config.scenes.length) sceneList.append(el('p', 'empty', 'No scenes in this floor plan. Add scenes in your floor-plan JSON.'));
  scenes.append(sceneTitle, sceneList);
  const toastNode = el('div', 'toast'); toastNode.id = 'toast'; toastNode.setAttribute('role', 'status');
  app.append(header, layout, scenes, toastNode);
  renderDevices(); update(); tickClock();
  try {
    world = createWorld(canvas, config, store, { background: 'transparent', resolution: () => RES, onHover() {}, onPick(t) { if (!t) return; if (t.kind === 'room') selectRoom(t.id); if (t.kind === 'light') command({ kind: 'light', id: t.id, on: !store.state.lights[t.id].on }); if (t.kind === 'ac') { const d = config.acs.find(d => d.id === t.id); deviceKind = 'acs'; selectRoom(d.room); acNodes.get(t.id)?.power.focus(); } } });
    world.setDaylight(theme.day, true); world.setInsets(70, 30); world.setRunning(true); world.intro();
    setTimeout(() => console.info('TV_RENDER_STATS', JSON.stringify(world?.stats())), 6000);
    resizeObserver?.disconnect(); resizeObserver = new ResizeObserver(() => world?.resize()); resizeObserver.observe(canvas);
  } catch (error) { stage.append(el('div', 'render-error', '3D is unavailable on this device. You can still use the controls on the right.')); console.error(error); }
  requestAnimationFrame(() => /** @type {HTMLElement | null} */ (tabs.querySelector('button'))?.focus({ preventScroll: true }));
  window.__houseTV = { get config() { return config; }, get state() { return store.state; }, get online() { return online; }, get world() { return world; }, command, selectRoom };
}
let theme = { day: false };
function applyTheme() {
  theme = { day: matchMedia('(prefers-color-scheme: light)').matches };
  document.documentElement.dataset.theme = theme.day ? 'day' : 'night';
  world?.setDaylight(theme.day);
}
applyTheme();
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);
document.addEventListener('visibilitychange', () => { if (!document.hidden) applyTheme(); });
function tickClock() { if ($('#clock')) $('#clock').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
setInterval(tickClock, 15000);
function closeModal() { modal?.remove(); modal = null; /** @type {HTMLElement | null} */ (lastFocus)?.focus(); }
function qr(value, size) { const c = el('canvas', 'info-qr'); c.setAttribute('aria-hidden', 'true'); QRCode.toCanvas(c, value, { width: size, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0a0e1a', light: '#ffffff' } }).catch(() => c.remove()); return c; }
function openInfo(kind) {
  const from = lastFocus; if (modal) closeModal(); lastFocus = from;
  modal = el('div', 'modal-backdrop'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', kind === 'about' ? 'About' : 'Support');
  const panel = el('section', 'sync-panel info-panel' + (kind === 'support' ? ' wide' : ''));
  const backButton = button('Back', 'ArrowLeft', () => { closeModal(); openSettings(); }, 'back-button'); panel.append(backButton);
  if (kind === 'about') {
    const version = bundle?.appVersion || '';
    panel.append(el('h2', '', ABOUT.app), el('p', 'sync-description', (version ? 'Version ' + version + ' · ' : '') + ABOUT.author + ' · ' + ABOUT.upstream));
    const links = el('ul', 'about-links');
    for (const l of ABOUT.links) { const li = el('li'); li.append(el('span', '', l.label), el('span', 'about-link', l.url.replace(/^https:\/\//, ''))); links.append(li); }
    const source = el('div', 'sync-content'); const text = el('div'); text.append(el('h3', '', 'Source code'), el('span', 'about-link', ABOUT.source.replace(/^https:\/\//, '')), el('p', 'sync-note', 'Scan to open the project on your phone.')); source.append(qr(ABOUT.source, 220), text);
    panel.append(links, source);
  } else {
    panel.append(el('h2', '', 'Support House Control for webOS'), el('p', 'sync-description', SUPPORT_INTRO));
    const grid = el('div', 'donations');
    for (const d of SUPPORT_LINKS) {
      const card = el('section', 'donation'); card.tabIndex = 0; card.setAttribute('aria-label', `${d.title}: ${d.detail}. ${d.url}`);
      card.append(el('h3', '', d.title), el('p', 'donation-network', d.detail), qr(d.url, 220), el('code', 'donation-address', d.url.replace(/^https:\/\//, '')));
      grid.append(card);
    }
    panel.append(grid);
  }
  modal.append(panel); document.body.append(modal); backButton.focus();
}
async function openSettings() {
  lastFocus = document.activeElement; modal = el('div', 'modal-backdrop');
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'House Control settings');
  const panel = el('section', 'sync-panel');
  const message = el('p', 'sync-note'); message.setAttribute('role', 'status');
  const haStatus = await api('/api/webos/ha/status');
  panel.append(el('h2', '', 'House Control for webOS'),
    el('p', 'sync-description', 'Import your floor plan and connect directly to Home Assistant on your local network.'));
  if (haStatus.connected || haStatus.reconnecting) {
    panel.append(el('p', 'sync-state', haStatus.connected ? 'Home Assistant connected · ' + haStatus.url : 'Home Assistant offline · reconnecting automatically'));
    panel.append(button('Disconnect Home Assistant', 'Power', async () => {
      try { await api('/api/webos/ha/disconnect', {}); await credentials.clear(); closeModal(); world?.dispose(); config = null; room = 'all'; await boot(); }
      catch (error) { message.textContent = error.message; }
    }, 'secondary'));
  } else {
    panel.append(createHASetupForm({
      async connect(input) {
        const connection = await api('/api/webos/ha/connect', input);
        if (!connection.connected) throw new Error('Return to the app to complete setup.');
        try {
          await credentials.save(input);
          return { persisted: true };
        } catch {
          return { persisted: false };
        }
      },
      async onConnected({ persisted }) {
        closeModal(); world?.dispose(); config = null; room = 'all'; await boot();
        toast(persisted ? 'Connected. Credentials saved securely.' : 'Connected for this session. Protected storage unavailable.');
      },
    }));
  }
  const connections = modal;
  const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', 'Import floor plan JSON');
  file.onchange = async () => {
    const selected = file.files?.[0];
    if (!selected || file.disabled) return;
    file.value = '';
    file.disabled = true;
    message.textContent = '';
    try {
      if (selected.size > 512 * 1024) throw new Error('Floor plan must be 512 KiB or less.');
      const payload = JSON.parse(await selected.text());
      const plan = payload?.plan ?? payload;
      const preview = await api('/api/webos/plan/preview', { plan });
      if (modal === connections) confirmImport(plan, preview.plan.name);
    } catch (error) {
      message.textContent = error.message;
    } finally {
      file.disabled = false;
      if (modal === connections && panel.isConnected) file.focus();
    }
  };
  /**
   * @param {import('./webos.js').RawPlan} payload
   * @param {string} name
   */
  function confirmImport(payload, name) {
    const confirmation = el('section', 'sync-panel');
    confirmation.tabIndex = -1;
    const description = el('p', 'sync-description', `Replace the current floor plan with “${name}”?`);
    description.id = 'webos-import-description';
    description.style.overflowWrap = 'anywhere';
    confirmation.style.maxHeight = '90vh';
    confirmation.style.overflow = 'auto';
    const actions = el('div', 'import-row');
    let submitting = false;

    function returnToConnections() {
      connections.replaceChildren(panel);
      connections.setAttribute('aria-label', 'House Control settings');
      connections.removeAttribute('aria-describedby');
      file.focus();
    }

    const cancel = button('Cancel', 'ArrowLeft', returnToConnections, 'secondary');
    const replace = button('Replace floor plan', 'Check', async () => {
      if (submitting || modal !== connections || !confirmation.isConnected) return;
      submitting = true;
      cancel.disabled = replace.disabled = true;
      confirmation.focus();
      try {
        await api('/api/import', { plan: payload, confirm: true });
      } catch (error) {
        message.textContent = error.message;
        if (modal === connections) returnToConnections();
        return;
      }
      if (modal === connections) closeModal();
      world?.dispose();
      config = null;
      room = 'all';
      await boot();
    }, 'primary');

    confirmation.onkeydown = event => {
      const isBack = event.key === 'Escape' || event.key === 'BrowserBack' || event.keyCode === 461;
      if (!isBack && event.key !== 'Tab') return;
      event.preventDefault();
      event.stopPropagation();
      if (submitting) return;
      if (isBack) returnToConnections();
      else (document.activeElement === cancel ? replace : cancel).focus();
    };
    actions.append(cancel, replace);
    confirmation.append(el('h2', '', 'Replace floor plan'), description, actions);
    connections.setAttribute('aria-label', 'Replace floor plan');
    connections.setAttribute('aria-describedby', description.id);
    connections.replaceChildren(confirmation);
    cancel.focus();
  }
  panel.append(el('p', 'sync-note', 'Import floor plan JSON'), file, message,
    button('Back to home', 'ArrowLeft', closeModal, 'secondary'),
    button('Reset bundled demo', 'RefreshCw', () => switchDemo(true).catch(error => { message.textContent = error.message; }), 'secondary'),
    button('About', 'Info', () => openInfo('about'), 'secondary'),
    button('Support', 'HandHeart', () => openInfo('support'), 'secondary'));
  modal.append(panel); document.body.append(modal); /** @type {HTMLElement | null} */ (panel.querySelector('button'))?.focus();
}
async function switchDemo(enabled) { await credentials.clear(); await api('/api/demo', { enabled }); closeModal(); world?.dispose(); config = null; await boot(); }
function focusables() { return [...(modal || app).querySelectorAll('button:not(:disabled),input,[tabindex="0"]')].filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height); }
function navigate(key) {
  const all = focusables(), current = document.activeElement;
  const focus = (n) => { if (n) { n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); } return true; };
  const selectedRoom = () => document.querySelector('[data-room="' + room + '"]');
  const deviceFilter = () => document.querySelector('[data-kind="' + deviceKind + '"]');
  const firstDevice = () => $('#device-list')?.querySelector('button:not(:disabled)');
  const scene = () => [...sceneNodes.values()].find(b => b.classList.contains('active')) || [...sceneNodes.values()][0];
  if (!modal && current?.matches('[data-room]')) {
    const tabs = [...document.querySelectorAll('[data-room]')], i = tabs.indexOf(current);
    if (key === 'ArrowDown') return focus(deviceFilter());
    if (key === 'ArrowUp') return true;
    if (key === 'ArrowLeft') return focus(tabs[Math.max(0, i - 1)]);
    if (key === 'ArrowRight') return focus(tabs[i + 1] || $('.sync-button'));
  }
  if (!modal && current?.matches('.sync-button')) {
    if (key === 'ArrowDown') return focus(deviceFilter());
    if (key === 'ArrowLeft') return focus([...document.querySelectorAll('[data-room]')].pop());
    return true;
  }
  if (current?.matches('[data-kind]')) {
    if (key === 'ArrowUp') return focus(selectedRoom());
    if (key === 'ArrowDown') return focus(deviceKind === 'lights' ? $('#all-off') : firstDevice() || scene());
    const filters = [...document.querySelectorAll('[data-kind]')], i = filters.indexOf(current);
    if (key === 'ArrowLeft') return focus(filters[i - 1] || $('#orbit'));
    if (key === 'ArrowRight') return focus(filters[i + 1] || current);
  }
  if (current?.matches('#all-off')) {
    if (key === 'ArrowUp') return focus(deviceFilter());
    if (key === 'ArrowDown') return focus(firstDevice() || scene());
    if (key === 'ArrowLeft') return focus($('#orbit'));
  }
  if (current?.matches('.light-row')) {
    const rows = [...$('#device-list').querySelectorAll('button:not(:disabled)')], i = rows.indexOf(current);
    if (key === 'ArrowDown') return focus(rows[i + 1] || scene());
    if (key === 'ArrowUp') return focus(rows[i - 1] || $('#all-off'));
    if (key === 'ArrowLeft') return focus($('#orbit'));
  }
  if (current?.matches('.scene-button')) {
    const scenes = [...sceneNodes.values()].filter(b => !b.disabled), i = scenes.indexOf(current);
    if (key === 'ArrowUp') return focus($('#orbit'));
    if (key === 'ArrowLeft') return focus(scenes[Math.max(0, i - 1)]);
    if (key === 'ArrowRight') return focus(scenes[Math.min(scenes.length - 1, i + 1)]);
  }
  if (current?.matches('#orbit')) {
    if (key === 'ArrowUp') return focus(selectedRoom());
    if (key === 'ArrowDown') return focus(scene());
    if (key === 'ArrowRight') return focus(firstDevice() || deviceFilter());
  }
  if (!all.includes(current)) { /** @type {HTMLElement | null} */ (all[0])?.focus(); return; }
  const a = current.getBoundingClientRect(), ax = a.x + a.width / 2, ay = a.y + a.height / 2;
  let best = null, score = Infinity;
  for (const b of all) {
    if (b === current) continue;
    const r = b.getBoundingClientRect(), dx = r.x + r.width / 2 - ax, dy = r.y + r.height / 2 - ay;
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    const forward = (key === 'ArrowRight' ? dx : key === 'ArrowLeft' ? -dx : key === 'ArrowDown' ? dy : -dy);
    if (forward < 3) continue;
    const cross = Math.abs(horizontal ? dy : dx);
    const cost = forward + cross * 2.8 + (cross > (horizontal ? a.height : a.width) * .75 ? 80 : 0);
    if (cost < score) { score = cost; best = b; }
  }
  if (best) { /** @type {HTMLElement} */ (best).focus({ preventScroll: true }); best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); }
}
function back() {
  if (modal) { closeModal(); return true; }
  if (orbiting) { orbiting = false; $('#orbit')?.classList.remove('active'); return true; }
  if (room !== 'all') { selectRoom('all'); /** @type {HTMLElement | null} */ (document.querySelector('[data-room="all"]'))?.focus(); return true; }
  return false;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' || e.key === 'BrowserBack' || e.keyCode === 461) {
    e.preventDefault(); if (!back()) window.close(); return;
  }
  if (orbiting && !modal) {
    if (e.key.startsWith('Arrow')) { e.preventDefault(); world?.orbit(e.key === 'ArrowLeft' ? -4 : e.key === 'ArrowRight' ? 4 : 0, e.key === 'ArrowUp' ? 3 : e.key === 'ArrowDown' ? -3 : 0); }
    if (e.key === 'Enter') { e.preventDefault(); back(); }
    return;
  }
  if (e.key.startsWith('Arrow')) { e.preventDefault(); navigate(e.key); }
});
document.addEventListener('visibilitychange', () => world?.setRunning(!document.hidden));
function showSetup(error) {
  app.replaceChildren();
  const box = el('div', 'setup');
  box.append(icon('House', 58), el('h1', '', 'House Control for webOS'), el('p', '', 'Could not load your home. Retry or open Settings to import a floor plan and connect Home Assistant.'), el('p', 'setup-error', error.message));
  box.append(button('Try again', 'RefreshCw', () => location.reload(), 'primary'));
  app.append(box);
  /** @type {HTMLElement | null} */ (box.querySelector('button'))?.focus();
}
async function boot() {
  try {
    const next = await api('/api/home');
    config = normalize(next.plan); bundle = next; online = !!(next.controlReady ?? next.macOnline); store.state = next.state;
    render(); apply(next);
  } catch (error) {
    console.warn('TV_BOOT', error.message);
    showSetup(error);
  }
}
window.addEventListener('weboshomechange', async () => {
  const next = await api('/api/home');
  if (config && next.revision === bundle?.revision) apply(next);
});
boot().then(async () => {
  try {
    const saved = await credentials.load();
    if (saved) {
      await api('/api/webos/ha/connect', saved);
      apply(await api('/api/home'));
    }
  } catch {
    toast('Could not restore the Home Assistant connection. Open Settings.');
  }
});
