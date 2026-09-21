// Solo play with no game server: hosts one Holdout room in-process and speaks server.js's protocol. It does not
// care where it runs (the static build's Web Worker, or Node in tests); the caller supplies post().
import { HoldoutRoom } from '../../../server/holdout/room.js';
import { cleanName } from '../../../server/baseRoom.js';

// post(string) for JSON, post(ArrayBuffer) for binary. Every buffer is a fresh copy, so the caller may transfer it.
export function startLocalServer(post) {
  let room = null, player = null, timer = null;
  const ws = { // what the room sees as the player's socket
    readyState: 1,
    send(d) {
      if (this.readyState !== 1) return;
      if (typeof d === 'string') post(d);
      else post(ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d.slice(0));
    },
  };
  return {
    receive(raw) {
      if (ws.readyState !== 1) return;
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (room) {
        try { room.handle(player, m); } catch (e) { console.error(e); }
        return;
      }
      if (m.t !== 'hello') return;
      try { // always a fresh room: join codes and quick play only mean something on a real server
        room = new HoldoutRoom('SOLO');
        player = room.addPlayer(ws, cleanName(m.name));
      } catch (e) {
        console.error(e);
        room = player = null;
        return post(JSON.stringify({ t: 'err', text: 'The offline game failed to start' }));
      }
      let last = Date.now();
      timer = setInterval(() => { // same 30 Hz tick and dt clamp as server.js
        const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        try { room.update(now, dt); } catch (e) { console.error(e); } // one bad tick must not end the game
      }, 1000 / 30);
    },
    stop() {
      clearInterval(timer);
      ws.readyState = 3;
      if (room && player) room.removePlayer(player);
      player = null;
    },
    get room() { return room; }, // tests and debugging
  };
}
