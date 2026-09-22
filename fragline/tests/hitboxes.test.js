// Zombie hit detection: shots test each zombie's boxes exactly as drawn that frame (public/js/zombies.js —
// hunched and nodding, arms up mid-swing, flyers' wings), and the server accepts those claims from a laggy
// client (room.js rayNearZombie). Plus the Bloater's acid: full damage to players, a light touch on builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { traceBullet } from '../shared/physics.js';
import { ZTYPES, ZTYPE_IDS, ZCLASS_IDS } from '../shared/zombies.js';
import { GRID } from '../shared/build.js';
import { makeGun } from '../server/holdout/inventory.js';
import { HoldoutRoom } from '../server/holdout/room.js';

// the browser serves shared/ at /shared/ — map that so zombies.js imports unchanged
const ROOT = new URL('../', import.meta.url).href;
registerHooks({ resolve: (spec, ctx, next) => next(spec.startsWith('/shared/') ? ROOT + spec.slice(1) : spec, ctx) });
const { ZombieView } = await import('../public/js/zombies.js');

let T = 30_000_000;
const realNow = Date.now;
test.before(() => { Date.now = () => T; });
test.after(() => { Date.now = realNow; });
const scene = { add() {}, remove() {} };
const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
// The head's centre as drawn, read from the render matrices (box 8 of a zombie's 11 body boxes, or the Shade's /
// a flyer's head mesh) — not from the hit list under test.
function headCentre(view, zb) {
  const e = zb.type === 'shade' ? view.shades.get(zb.id).root.children[2].matrixWorld.elements
    : zb.t.flyer ? view.flyers.get(zb.id).root.children[1].matrixWorld.elements
    : view.body.instanceMatrix.array.subarray((zb.slot * 11 + 8) * 16);
  return [e[12], e[13], e[14]];
}
// a shooter 10 m from p: az turns away from the zombie's facing (0 = in front of it), el raises (or lowers) the view
const shooter = (p, yaw, az, el) => [p[0] - Math.sin(yaw + az) * Math.cos(el) * 10, p[1] + Math.sin(el) * 10, p[2] - Math.cos(yaw + az) * Math.cos(el) * 10];

test('every zombie type, walking or mid-swing: a shot through the centre of its drawn head is a head hit the server accepts', () => {
  const view = new ZombieView(scene), room = new HoldoutRoom('HB', {});
  let id = 0;
  for (const type of ZTYPE_IDS) {
    const t = ZTYPES[type];
    for (const cls of t.boss || t.noVariant ? [''] : ['', 'tank']) for (const st of t.ranged || t.sniper ? [0, 1, 2, 3] : [0, 1, 2]) {
      const yaw = 0.7, speed = st ? 0 : t.speed, f = [-Math.sin(yaw), -Math.cos(yaw)], y = t.flyer ? 15 : 0;
      view.spawn([++id, ZTYPE_IDS.indexOf(type), 100, 0, 0, yaw, ZCLASS_IDS.indexOf(cls)], 0);
      const zb = view.list.get(id);
      view.offset = 0;
      zb.snaps = Array.from({ length: 30 }, (_, k) => ({ t: k / 15, x: (f[0] * speed * k) / 15, y, z: (f[1] * speed * k) / 15, yaw, st, hp: 1 }));
      for (let i = 0; i < 60; i++) view.update(1 / 60, 0.3 + i / 60, null);
      const c = headCentre(view, zb), z = { pos: [...zb.pos], s: zb.s, hist: [] };
      const views = t.flyer ? [[0, -0.5], [Math.PI / 2, -0.5], [-Math.PI / 2, 0]] : [[0, 0], [Math.PI / 2, 0], [-Math.PI / 2, 0], [0, 0.5], [Math.PI / 2, 0.5]];
      for (const [az, el] of views) {
        const eye = shooter(c, zb.yaw, az, el), d = unit(c.map((v, i) => v - eye[i]));
        const what = `${type}${cls && '/' + cls} in state ${st}, seen from ${az.toFixed(2)} / ${el}`;
        assert.equal(traceBullet(eye, d, 400, [], view.targets(), 1).player?.part, 'head', what);
        assert.ok(room.rayNearZombie(eye, d, z), `${what}: the server accepts it`);
      }
      for (const [m, k, part] of zb.hit) { // any other drawn box is a fair claim too: arms up mid-swing, wings, a belly
        const p = [m[k + 12], m[k + 13], m[k + 14]], eye = shooter(p, zb.yaw, Math.PI / 2, 0.3);
        assert.ok(room.rayNearZombie(eye, unit(p.map((v, i) => v - eye[i])), z), `${type}${cls && '/' + cls} in state ${st}: a shot at its ${part} is accepted`);
      }
      view.remove(id);
    }
  }
});

test('a moving zombie with 100-200 ms of lag: the shot through its drawn head lands as a headshot on the server', () => {
  for (const type of ['runner', 'stalker', 'brute', 'swooper']) for (const lag of [100, 200]) {
    const room = new HoldoutRoom('LAG', {}), late = [], msgs = [];
    room.phase = 'prep';
    const p = room.addPlayer({ readyState: 1, send: s => { late.push([T + lag, s]); if (typeof s === 'string') msgs.push(JSON.parse(s)); } }, 'P');
    room.startWave(1); room.director.queue = [];
    p.st.p = [60, 0, 60]; // out of the way until it shoots
    const gun = makeGun('ar');
    p.inv[1] = gun;
    const z = room.spawnZombie(type, 'N', '');
    z.hp = z.maxHp = 1e6;
    z.spd *= 1.5; // flat out, like a berserk straggler
    const view = new ZombieView(scene);
    let shot = null, landed = false;
    for (let f = 1; f < 300 && !landed; f++) { // 60 fps client, 30 Hz server; each way takes `lag` ms
      T += 1000 / 60;
      if (f % 2 === 0) room.update(T, 1 / 30);
      while (late.length && late[0][0] <= T) {
        const s = late.shift()[1];
        if (typeof s !== 'string') view.snapshot(s, T / 1000);
        else { const m = JSON.parse(s); if (m.t === 'zsp') for (const q of m.z) view.spawn(q, T / 1000); }
      }
      view.update(1 / 60, T / 1000, null);
      if (f === 90) { // 1.5 s in: shoot the drawn head from the side (a flyer from the ground below)
        const zb = view.list.get(z.id), c = headCentre(view, zb), eye = shooter(c, zb.yaw, Math.PI / 2, zb.t.flyer ? -0.9 : 0.2);
        const d = unit(c.map((v, i) => v - eye[i])), hit = traceBullet(eye, d, 400, [], view.targets(), 1).player;
        assert.equal(hit?.part, 'head', `${type}, ${lag} ms: the client scores the drawn head`);
        shot = { at: T + lag, o: eye, d, h: [{ id: z.id, part: hit.part, pen: 1, k: 0 }] };
      }
      if (shot && T >= shot.at) { // the claim arrives: the zombie has moved on since
        // what the client drew is ~2 × lag + 100 ms (render delay) + up to a snapshot gap old by now
        assert.ok(T - z.hist[0] >= 2 * lag + 170, `${type}, ${lag} ms: the server still remembers where the client saw it`);
        p.st.p = [shot.o[0], shot.o[1] - 1.6, shot.o[2]];
        room.handle(p, { t: 'shot', w: 'ar', uid: gun.uid, o: shot.o, d: [shot.d], e: [], h: shot.h });
        const dmg = msgs.filter(m => m.t === 'dmg' && m.vic === 'z' + z.id).at(-1);
        assert.ok(z.hp < z.maxHp, `${type}, ${lag} ms: the server accepted the claim`);
        assert.equal(dmg?.part, 'head', `${type}, ${lag} ms: as a headshot`);
        landed = true;
      }
    }
    assert.ok(landed, `${type}, ${lag} ms: the shot went out`);
    assert.ok(!room.rayNearZombie(shot.o, shot.d.map(v => -v), z), `${type}: still a real check — the same shot fired the other way is rejected`);
  }
});

test('Bloater burst: players take the full acid, builds about 70 % less than before', () => {
  const tile = (x, zz) => ({ i: (x - GRID.x0) / GRID.cell, k: (zz - GRID.z0) / GRID.cell });
  // one burst next to a full Zinkonium wall and a player: what the wall loses (impact + the pool's whole life)
  const burst = b => {
    const room = new HoldoutRoom('BL', {}), msgs = [];
    const p = room.addPlayer({ readyState: 1, send: s => { if (typeof s === 'string') msgs.push(JSON.parse(s)); } }, 'P');
    room.startPrep();
    p.st.p = [-2, 0, -6];
    room.handle(p, { t: 'build', kind: 'wall', ...tile(-4, -8), l: 0, o: 0, mat: 'zink' });
    const advance = ms => { for (let t = 0; t < ms; t += 50) { T += 50; room.update(T, 0.05); } };
    advance(4100);
    const s = room.builds()[0], full = s.hp;
    room.startWave(1); room.director.queue = [];
    const bl = room.spawnZombie('bloater', 'N', '');
    bl.t = { ...bl.t, burst: b };
    bl.pos = [(s.box.min[0] + s.box.max[0]) / 2, 0, s.box.min[2] - 1];
    p.st.p = [bl.pos[0] + 1.5, 0, bl.pos[2] - 1];
    room.killZombie(bl, p, 'ar');
    const hurt = msgs.find(m => m.t === 'dmg' && m.vic === p.id)?.dmg;
    advance(b.pool * 1000 + 500);
    return { wall: full - s.hp, hurt };
  };
  const b = ZTYPES.bloater.burst, now = burst(b), before = burst({ ...b, sdmg: 120, sdps: 30 });
  assert.equal(now.hurt, before.hurt, 'the burst hits players as hard as ever');
  assert.ok(now.hurt >= b.dmg, `players take the full burst (${now.hurt})`);
  const k = now.wall / before.wall;
  assert.ok(now.wall > 0 && k > 0.25 && k < 0.35, `walls take ~30 % of the old acid damage (${now.wall.toFixed(1)} vs ${before.wall.toFixed(1)})`);
});
