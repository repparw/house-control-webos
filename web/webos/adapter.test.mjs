import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webosAPI } from '../src/webos.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function waitForOperation(predicate) {
  let operation = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    operation = await webosAPI('/api/webos/operation');
    if (predicate(operation)) return operation;
    await tick();
  }
  return operation;
}

function plan() {
  return {
    version: 1,
    name: 'Adapter test home',
    rooms: [{ id: 'room', name: 'Room', rect: [0, 0, 5, 5], floor: 'oak' }],
    lights: [
      { id: 'sim', name: 'Simulated lamp', room: 'room', type: 'ceiling', pos: [1, 1] },
      { id: 'ha', name: 'Linked lamp', room: 'room', type: 'pendant', pos: [2, 1], link: { service: 'homeassistant', id: 'light.ha' } },
    ],
    acs: [],
    scenes: [
      { id: 'all-on', name: 'All on', lights: { '*': { on: true } } },
      { id: 'toggle', name: 'Toggle', toggle: true, lights: { sim: { on: true } } },
    ],
  };
}

function labeledPlan() {
  const value = plan();
  value.lights.find(device => device.id === 'ha').name = 'Ceiling over sofa';
  return value;
}

function labeledState(attributes = { friendly_name: 'Pieza' }) {
  return {
    entity_id: 'light.ha', state: 'off', attributes, last_updated: new Date().toISOString(),
  };
}

class FakeSocket {
  static instances = [];
  static states = [];
  static failEntities = new Set();
  static snapshotTime = new Date().toISOString();

  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.sent = [];
    this.closed = false;
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.emit({ type: 'auth_required' }));
  }

  emit(message) { this.onmessage?.({ data: JSON.stringify(message) }); }

  send(value) {
    const message = JSON.parse(value);
    this.sent.push(message);
    if (message.type === 'auth') queueMicrotask(() => this.emit({ type: 'auth_ok' }));
    else if (message.type === 'subscribe_events') {
      this.subscriptionId = message.id;
      queueMicrotask(() => this.emit({ id: message.id, type: 'result', success: true, result: null }));
    } else if (message.type === 'get_states') {
      queueMicrotask(() => this.emit({ id: message.id, type: 'result', success: true, result: structuredClone(FakeSocket.states) }));
    } else if (message.type === 'call_service') {
      const entityId = message.service_data?.entity_id;
      queueMicrotask(() => this.emit(entityId && FakeSocket.failEntities.has(entityId)
        ? { id: message.id, type: 'result', success: false, error: { message: 'The entity rejected the command.' } }
        : { id: message.id, type: 'result', success: true, result: null }));
    }
  }

  emitState(entityId, state, timestamp = new Date().toISOString()) {
    const current = FakeSocket.states.find(item => item.entity_id === entityId);
    this.emit({
      type: 'event',
      id: this.subscriptionId,
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: entityId,
          new_state: { entity_id: entityId, state, attributes: structuredClone(current?.attributes || {}), last_updated: timestamp },
        },
      },
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
}

function useStorage() {
  const saved = new Map();
  globalThis.localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key),
  };
  return saved;
}

async function install(planValue = plan(), states = [
  { entity_id: 'light.ha', state: 'off', attributes: { friendly_name: 'Kitchen' }, last_updated: new Date().toISOString() },
]) {
  useStorage();
  globalThis.WebSocket = FakeSocket;
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(planValue) });
  FakeSocket.instances = [];
  FakeSocket.states = structuredClone(states);
  FakeSocket.failEntities = new Set();
  FakeSocket.snapshotTime = new Date().toISOString();
  await webosAPI('/api/home');
  await webosAPI('/api/import', { plan: planValue, confirm: true });
}

async function connect() {
  return webosAPI('/api/webos/ha/connect', { url: '192.168.0.20', token: 'z'.repeat(40) });
}

test('foreground lifecycle closes Home Assistant and reconnects with a fresh snapshot', async () => {
  await install();
  await connect();
  assert.equal(FakeSocket.instances.length, 1);
  assert.equal((await webosAPI('/api/webos/ha/status')).state, 'connected');

  const hidden = await webosAPI('/api/webos/visibility', { visible: false });
  assert.equal(hidden.state, 'paused');
  assert.equal((await webosAPI('/api/home')).state.lights.ha.displayName, 'Kitchen');
  assert.equal(hidden.reconnecting, false);
  assert.equal(FakeSocket.instances[0].readyState, 3);

  const resumed = await webosAPI('/api/webos/visibility', { visible: true });
  assert.equal(resumed.state, 'connected');
  assert.equal(FakeSocket.instances.length, 2);
  assert.equal(FakeSocket.instances[1].sent.filter(message => message.type === 'get_states').length, 1);
  await webosAPI('/api/webos/ha/disconnect', {});
});

test('offline linked devices stay stale while simulated devices remain controllable', async () => {
  await install();
  await connect();
  const socket = FakeSocket.instances[0];
  socket.emitState('light.ha', 'on');
  await tick();

  let current = await webosAPI('/api/home');
  assert.equal(current.state.lights.ha.on, true);
  assert.equal(current.state.lights.ha.status, 'live');

  socket.close();
  await tick();
  current = await webosAPI('/api/home');
  assert.equal(current.state.lights.ha.on, true);
  assert.equal(current.state.lights.ha.stale, true);
  assert.equal(current.state.lights.ha.online, false);
  assert.equal(current.state.lights.ha.controlEnabled, false);
  assert.equal(current.connection.state, 'offline');

  await assert.rejects(webosAPI('/api/action', { kind: 'light', id: 'ha', on: false }), /Connect Home Assistant/);
  const simulated = await webosAPI('/api/action', { kind: 'light', id: 'sim', on: false });
  assert.equal(simulated.home.state.lights.sim.on, false);
  assert.equal(simulated.home.state.lights.sim.simulated, true);
  assert.equal(simulated.home.state.lights.sim.controlEnabled, true);
  await webosAPI('/api/webos/ha/disconnect', {});
});

test('plan replacement requires confirmation, preserves compatible simulation and keeps the HA connection', async () => {
  await install();
  await connect();
  await webosAPI('/api/action', { kind: 'light', id: 'sim', on: false });
  const serviceCalls = FakeSocket.instances[0].sent.filter(message => message.type === 'call_service').length;

  const replacement = structuredClone(plan());
  replacement.name = 'Confirmed replacement';
  const preview = await webosAPI('/api/webos/plan/preview', { plan: replacement });
  assert.equal(preview.requiresConfirmation, true);
  await assert.rejects(
    webosAPI('/api/import', { plan: replacement }),
    error => error.code === 'PLAN_CONFIRMATION_REQUIRED' && error.details.valid === true,
  );
  await assert.rejects(webosAPI('/api/import', { plan: { rooms: [] }, confirm: true }), /Plan needs at least one room/);
  assert.equal((await webosAPI('/api/home')).plan.name, 'Adapter test home');

  const imported = await webosAPI('/api/import', { plan: replacement, confirm: true });
  assert.equal(imported.home.plan.name, 'Confirmed replacement');
  assert.equal(imported.home.state.lights.sim.on, false);
  assert.equal((await webosAPI('/api/webos/ha/status')).connected, true);
  assert.equal(FakeSocket.instances[0].sent.filter(message => message.type === 'call_service').length, serviceCalls);
  await webosAPI('/api/webos/ha/disconnect', {});
});

test('optimistic commands stay pending until authoritative state confirms them', async () => {
  await install();
  await connect();
  const socket = FakeSocket.instances[0];

  const accepted = await webosAPI('/api/action', { kind: 'light', id: 'ha', on: true });
  assert.equal(accepted.home.state.lights.ha.on, true);
  assert.equal(accepted.home.state.lights.ha.pending, true);
  assert.equal(accepted.home.operation.status, 'pending');

  socket.emitState('light.ha', 'on');
  await tick();
  let current = await webosAPI('/api/home');
  assert.equal(current.state.lights.ha.pending, false);
  assert.equal(current.state.lights.ha.error, null);
  assert.equal(current.operation.status, 'complete');

  await webosAPI('/api/action', { kind: 'light', id: 'ha', on: false });
  socket.emitState('light.ha', 'on');
  await tick();
  current = await webosAPI('/api/home');
  assert.equal(current.state.lights.ha.on, true);
  assert.equal(current.state.lights.ha.pending, false);
  assert.match(current.state.lights.ha.error, /changed by Home Assistant/);
  await webosAPI('/api/webos/ha/disconnect', {});
});

test('a newer command is not overwritten by an older state event', async () => {
  const old = new Date(Date.now() - 10000).toISOString();
  await install(plan(), [{ entity_id: 'light.ha', state: 'off', attributes: {}, last_updated: old }]);
  await connect();
  const socket = FakeSocket.instances[0];

  await webosAPI('/api/action', { kind: 'light', id: 'ha', on: true });
  await webosAPI('/api/action', { kind: 'light', id: 'ha', on: false });
  socket.emitState('light.ha', 'on', new Date(Date.now() - 2000).toISOString());
  await tick();
  let current = await webosAPI('/api/home');
  assert.equal(current.state.lights.ha.on, false);
  assert.equal(current.state.lights.ha.pending, true);

  socket.emitState('light.ha', 'off');
  await tick();
  current = await webosAPI('/api/home');
  assert.equal(current.state.lights.ha.on, false);
  assert.equal(current.state.lights.ha.pending, false);
  await webosAPI('/api/webos/ha/disconnect', {});
});

test('scene failures are per device, do not roll back successes and do not select a partial scene', async () => {
  const value = plan();
  value.lights.push({
    id: 'ha2', name: 'Second linked lamp', room: 'room', type: 'table', pos: [3, 1],
    link: { service: 'homeassistant', id: 'light.ha2' },
  });
  const now = new Date().toISOString();
  await install(value, [
    { entity_id: 'light.ha', state: 'off', attributes: {}, last_updated: now },
    { entity_id: 'light.ha2', state: 'off', attributes: {}, last_updated: now },
  ]);
  await connect();
  FakeSocket.failEntities.add('light.ha2');
  const socket = FakeSocket.instances[0];

  await webosAPI('/api/action', { kind: 'scene', id: 'all-on' });
  await tick();
  socket.emitState('light.ha', 'on');
  await tick();
  await tick();

  const operation = await webosAPI('/api/webos/operation');
  assert.equal(operation.status, 'partial');
  assert.equal(operation.failures.length, 1);
  assert.equal(operation.failures[0].id, 'ha2');
  const current = await webosAPI('/api/home');
  assert.equal(current.state.lights.ha.on, true);
  assert.equal(current.state.lights.ha2.on, false);
  assert.equal(current.state.scene, null);
  assert.equal(socket.sent.filter(message => message.type === 'call_service').length, 2);
  await webosAPI('/api/webos/ha/disconnect', {});
});

test('toggle scenes turn their targets off and back on again', async () => {
  await install();
  await webosAPI('/api/action', { kind: 'light', id: 'sim', on: true });
  const off = await webosAPI('/api/action', { kind: 'scene', id: 'toggle' });
  assert.equal(off.home.state.lights.sim.on, false);
  assert.equal(off.home.state.scene, null);
  const on = await webosAPI('/api/action', { kind: 'scene', id: 'toggle' });
  assert.equal(on.home.state.lights.sim.on, true);
});

test('uses the Home Assistant display name in unavailable errors and falls back to the plan name', async () => {
  await install(labeledPlan(), [{ ...labeledState(), state: 'unavailable' }]);
  await connect();
  await assert.rejects(
    webosAPI('/api/action', { kind: 'light', id: 'ha', on: false }),
    error => error.code === 'ENTITY_UNAVAILABLE' && error.message.includes('Pieza') && !error.message.includes('Ceiling over sofa'),
  );
  await webosAPI('/api/webos/ha/disconnect', {});

  await install(labeledPlan(), [{ ...labeledState({}), state: 'unavailable' }]);
  await connect();
  await assert.rejects(
    webosAPI('/api/action', { kind: 'light', id: 'ha', on: false }),
    error => error.code === 'ENTITY_UNAVAILABLE' && error.message.includes('Ceiling over sofa') && !error.message.includes('Pieza'),
  );
  await webosAPI('/api/webos/ha/disconnect', {});
});

test('uses the Home Assistant display name for rejected command operation failures', async () => {
  await install(labeledPlan(), [labeledState()]);
  await connect();
  FakeSocket.failEntities.add('light.ha');

  await webosAPI('/api/action', { kind: 'light', id: 'ha', on: true });
  await tick();
  const operation = await webosAPI('/api/webos/operation');
  assert.equal(operation.status, 'failed');
  assert.equal(operation.failures[0].name, 'Pieza');
  assert.match(operation.failures[0].message, /Pieza/);
  assert.doesNotMatch(operation.failures[0].message, /Ceiling over sofa/);
  assert.match(operation.message, /Pieza/);
  assert.doesNotMatch(operation.message, /Ceiling over sofa/);
  await webosAPI('/api/webos/ha/disconnect', {});
});

test('uses the Home Assistant display name in superseded and corrected conflicts', async () => {
  await install(labeledPlan(), [labeledState()]);
  await connect();
  const socket = FakeSocket.instances[0];

  const first = await webosAPI('/api/action', { kind: 'light', id: 'ha', on: true });
  await webosAPI('/api/action', { kind: 'light', id: 'ha', on: false });
  await tick();
  let operations = await webosAPI('/api/webos/operations');
  let superseded = operations.find(operation => operation.id === first.operation.id);
  assert.equal(superseded.failures[0].code, 'COMMAND_SUPERSEDED');
  assert.equal(superseded.failures[0].name, 'Pieza');
  assert.match(superseded.failures[0].message, /Pieza/);
  assert.doesNotMatch(superseded.failures[0].message, /Ceiling over sofa/);
  socket.emitState('light.ha', 'off');
  await tick();

  const correction = await webosAPI('/api/action', { kind: 'light', id: 'ha', on: true });
  socket.emitState('light.ha', 'off');
  await tick();
  operations = await webosAPI('/api/webos/operations');
  const corrected = operations.find(operation => operation.id === correction.operation.id);
  assert.equal(corrected.failures[0].code, 'STATE_CORRECTED');
  assert.equal(corrected.failures[0].name, 'Pieza');
  assert.match(corrected.failures[0].message, /Pieza/);
  assert.doesNotMatch(corrected.failures[0].message, /Ceiling over sofa/);
  await webosAPI('/api/webos/ha/disconnect', {});
});

test('uses the Home Assistant display name in scene state failures', async () => {
  await install(labeledPlan(), [labeledState()]);
  await connect();
  const socket = FakeSocket.instances[0];

  await webosAPI('/api/action', { kind: 'scene', id: 'all-on' });
  await tick();
  socket.emitState('light.ha', 'on');
  FakeSocket.states[0].last_updated = new Date(Date.now() + 1000).toISOString();
  await tick();

  const operation = await waitForOperation(value => value?.failures?.length > 0);
  assert.equal(operation.failures.length, 1);
  assert.equal(operation.failures[0].name, 'Pieza');
  assert.match(operation.failures[0].message, /Pieza/);
  assert.match(operation.failures[0].message, /did not reach the requested scene state/);
  assert.doesNotMatch(operation.failures[0].message, /Ceiling over sofa/);
  await webosAPI('/api/webos/ha/disconnect', {});
});

test('publishes light capabilities, the app version and the supported temperature range', async () => {
  await install(labeledPlan(), [labeledState({
    friendly_name: 'Pieza',
    supported_color_modes: ['color_temp'],
    min_color_temp_kelvin: 2000,
    max_color_temp_kelvin: 6535,
  })]);
  await connect();

  const current = await webosAPI('/api/home');
  assert.deepEqual(current.state.lights.sim.capabilities, {
    brightness: true, temp: true, color: true, minTemp: 2200, maxTemp: 6500,
  });
  assert.deepEqual(current.state.lights.ha.capabilities, {
    brightness: true, temp: true, color: false, minTemp: 2000, maxTemp: 6535,
  });
  assert.ok(Object.hasOwn(current, 'appVersion'));
  assert.ok(current.appVersion === null || typeof current.appVersion === 'string');

  await webosAPI('/api/action', { kind: 'lightSet', id: 'ha', temp: 2000 });
  await assert.rejects(webosAPI('/api/action', { kind: 'lightSet', id: 'ha', temp: 1900 }), /Invalid colour temperature/);
  await assert.rejects(webosAPI('/api/action', { kind: 'lightSet', id: 'ha', temp: Number.NaN }), /Invalid colour temperature/);
  await webosAPI('/api/webos/ha/disconnect', {});
});
