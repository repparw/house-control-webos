// Home Assistant WebSocket API double for the packaged UI tests. It implements
// the subset of /api/websocket that HAConnection (src/webos-ha.js) speaks:
// auth_required → auth → auth_ok, subscribe_events, get_states snapshots,
// call_service applied to entity state like a real server, state_changed
// events, and forced drops for the reconnect path.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

export class MockHomeAssistant {
  #token;
  #entities = new Map();
  #http = createServer();
  #wss = new WebSocketServer({ noServer: true });
  #clients = new Set();
  #authed = new Set();
  #subscriptions = new Map();
  #port = null;
  /** Service calls the app made, in order: { domain, service, service_data }. */
  calls = [];
  /** Access tokens presented at auth, in order. */
  auths = [];
  /** Successful auths since start(), including reconnects. */
  connections = 0;

  constructor({ token, entities }) {
    this.#token = token;
    for (const entity of entities) this.#entities.set(entity.entity_id, { ...entity });
  }

  /** Address for the app's settings form; Chromium maps "homeassistant" to loopback. */
  get url() {
    if (this.#port === null) throw new Error('Mock server not started.');
    return `http://homeassistant:${this.#port}`;
  }

  start() {
    this.#http.on('upgrade', (request, socket, head) => {
      if (request.url !== '/api/websocket') {
        socket.destroy();
        return;
      }
      this.#wss.handleUpgrade(request, socket, head, socket_ => this.#admit(socket_));
    });
    return new Promise(resolve => {
      this.#http.listen(0, '127.0.0.1', () => {
        this.#port = this.#http.address().port;
        resolve(this.url);
      });
    });
  }

  /** Force the current sockets closed, like a network drop after connecting. */
  drop() {
    for (const client of [...this.#clients]) client.close();
  }

  async close() {
    for (const client of [...this.#clients]) client.terminate();
    this.#clients.clear();
    await new Promise(resolve => this.#wss.close(() => resolve()));
    await new Promise(resolve => this.#http.close(() => resolve()));
  }

  #send(client, message) {
    client.send(JSON.stringify(message));
  }

  #admit(client) {
    this.#clients.add(client);
    this.#send(client, { type: 'auth_required' });
    client.on('message', data => {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      this.#message(client, message);
    });
    client.on('close', () => {
      this.#clients.delete(client);
      this.#authed.delete(client);
      this.#subscriptions.delete(client);
    });
    client.on('error', () => client.terminate());
  }

  #message(client, message) {
    if (message.type === 'auth') {
      this.auths.push(message.access_token);
      if (message.access_token !== this.#token) {
        this.#send(client, { type: 'auth_invalid', message: 'Invalid access token.' });
        client.close();
        return;
      }
      this.connections += 1;
      this.#authed.add(client);
      this.#send(client, { type: 'auth_ok', ha_version: '2026.1.0' });
      return;
    }
    if (!this.#authed.has(client)) return;
    switch (message.type) {
      case 'subscribe_events':
        this.#subscriptions.set(client, message.id);
        this.#send(client, { id: message.id, type: 'result', success: true, result: null });
        return;
      case 'get_states':
        this.#send(client, { id: message.id, type: 'result', success: true, result: this.#snapshot() });
        return;
      case 'call_service':
        this.#call(message);
        this.#send(client, { id: message.id, type: 'result', success: true, result: null });
        return;
      default:
        this.#send(client, { id: message.id, type: 'result', success: false, error: { message: 'Unsupported by the mock.' } });
    }
  }

  #snapshot() {
    return [...this.#entities.values()].map(entity => ({ ...entity }));
  }

  #call(message) {
    this.calls.push({ domain: message.domain, service: message.service, service_data: message.service_data });
    const entityId = message.service_data?.entity_id;
    if (!this.#entities.has(entityId)) return;
    if (message.service === 'turn_on') this.#applyState(entityId, { state: 'on' });
    if (message.service === 'turn_off') this.#applyState(entityId, { state: 'off' });
    this.#broadcastState(entityId);
  }

  #applyState(entityId, patch) {
    const entity = this.#entities.get(entityId);
    Object.assign(entity, patch);
    entity.last_updated = new Date().toISOString();
  }

  #broadcastState(entityId) {
    const entity = this.#entities.get(entityId);
    for (const client of [...this.#clients]) {
      const subscription = this.#subscriptions.get(client);
      if (subscription === undefined) continue;
      this.#send(client, {
        id: subscription,
        type: 'event',
        event: { event_type: 'state_changed', data: { entity_id: entityId, new_state: { ...entity } } },
      });
    }
  }
}