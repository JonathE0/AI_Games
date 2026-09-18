// Shared room plumbing: messaging, weapon items with unique ids, and relaying the movement, sounds and
// chat that clients report.
import { WEAPONS } from '../shared/weapons.js';

let uid = 1;
export const nextUid = () => uid++;

export class BaseRoom {
  newItem(w) { return { w, uid: uid++ }; }

  // Messages every room handles the same way. Returns true when the message was consumed.
  handleCommon(p, m) {
    switch (m.t) {
      case 'st': this.onState(p, m); return true;
      case 'snd':
        if (['reload', 'deploy', 'scope', 'shell'].includes(m.s)) this.broadcast({ t: 'snd', id: p.id, s: m.s, w: m.w }, p);
        return true;
      case 'ping':
        p.ping = m.ping | 0;
        this.send(p, { t: 'pong', ts: m.ts });
        return true;
      case 'chat':
        this.broadcast({ t: 'chat', name: p.name, text: String(m.text || '').slice(0, 120) });
        return true;
    }
    return false;
  }

  onState(p, m) {
    if (!Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
    p.st = {
      p: m.p, v: Array.isArray(m.v) ? m.v.map(n => +n || 0) : [0, 0, 0], y: +m.y || 0, pi: +m.pi || 0,
      c: Math.min(1, Math.max(0, +m.c || 0)), w: WEAPONS[m.w] ? m.w : 'knife', g: !!m.g, ...(m.fl ? { fl: 1 } : {}),
    };
    this.broadcast({ t: 'st', id: p.id, ...p.st, ts: Number.isFinite(+m.ts) ? +m.ts : undefined }, p);
  }

  send(p, msg) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const p of this.players) if (p !== except && p.ws && p.ws.readyState === 1) p.ws.send(s);
  }
}
