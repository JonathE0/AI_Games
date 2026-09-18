// Thin WebSocket wrapper with a ping loop. JSON messages go to onMsg, binary frames (Holdout zombie
// snapshots) to onBin.
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
      const ws = this.ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now(), ping: Math.round(this.ping) }), 2000);
        resolve();
      };
      ws.onerror = () => reject(new Error('Could not reach the game server — is `npm start` running?'));
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
