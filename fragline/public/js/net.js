// Thin WebSocket wrapper with a ping loop. JSON messages go to onMsg, binary frames (Holdout zombie
// snapshots) to onBin. The transport comes from public/config.js: the Node server's own host by default, a remote
// server when `server` is set, or — in the static solo build — a room running in a Web Worker.
const CFG = globalThis.FRAGLINE_CONFIG || {};
export const SOLO = !!CFG.static && !CFG.server;

// WebSocket stand-in for the static solo build: the room runs in js/local/worker.js.
class LocalSocket {
  constructor() {
    Object.assign(this, { readyState: 0, binaryType: 'arraybuffer', onopen: null, onmessage: null, onclose: null, onerror: null });
    try { this.worker = new Worker('/js/local/worker.js', { type: 'module' }); } catch { setTimeout(() => this.fail()); return; }
    this.worker.onmessage = e => {
      if (e.data === '__ready') { // the worker's whole import graph loaded: the room is up
        if (this.readyState === 0) { this.readyState = 1; this.onopen?.(); }
      } else if (this.readyState === 1) this.onmessage?.({ data: e.data });
    };
    // a load/import failure; later errors are already reported in the console and the room catches its own
    this.worker.onerror = this.worker.onmessageerror = () => { if (this.readyState === 0) this.fail(); };
  }

  fail() {
    this.onerror?.(new Event('error'));
    this.close();
  }

  send(s) {
    if (this.readyState === 1) this.worker.postMessage(s);
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.worker?.terminate();
    this.onclose?.();
  }
}

export class Net {
  constructor(onMsg, onClose, onBin = null) {
    this.onMsg = onMsg;
    this.onClose = onClose;
    this.onBin = onBin;
    this.ws = null;
    this.ping = 0;
  }

  connect() {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = this.ws = SOLO ? new LocalSocket()
        : new WebSocket(CFG.server ? String(CFG.server).replace(/^http/, 'ws') : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now(), ping: Math.round(this.ping) }), 2000);
        resolve();
      };
      ws.onerror = () => reject(new Error(SOLO ? 'Could not start the offline game in this browser'
        : CFG.server ? 'Could not reach the game server' : 'Could not reach the game server — is `npm start` running?'));
      ws.onmessage = e => {
        if (typeof e.data !== 'string') { this.onBin?.(e.data); return; }
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'pong') { this.ping = performance.now() - m.ts; return; }
        this.onMsg(m);
      };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (this.ws === ws) { this.ws = null; this.onClose(); }
      };
    });
  }

  send(m) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    clearInterval(this.pingTimer);
    ws?.close();
  }
}
