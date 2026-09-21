import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../public/js/local/localserver.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (ok, ms = 2000) => { for (const end = Date.now() + ms; !ok() && Date.now() < end;) await sleep(20); };

function build(out, serverUrl) {
  const env = { ...process.env };
  if (serverUrl) env.HOLDOUT_SERVER_URL = serverUrl; else delete env.HOLDOUT_SERVER_URL;
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-static.mjs'), '--out', out, '--list'], { cwd: ROOT, env, encoding: 'utf8' });
  const win = {};
  if (r.status === 0) new Function('window', fs.readFileSync(path.join(out, 'config.js'), 'utf8'))(win);
  return { ...r, config: win.FRAGLINE_CONFIG, graph: r.stdout.split(/\r?\n/) };
}

test('the static build holds everything the browser loads, and its module walk proves it', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fragline-static-')), out = path.join(tmp, 'dist');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const r = build(out);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.config, { static: true, server: null });
  for (const f of ['js/local/worker.js', 'server/holdout/room.js', 'lib/three/build/three.core.js', 'lib/three/examples/jsm/environments/RoomEnvironment.js'])
    assert.ok(r.graph.includes(f), `the module walk reached ${f}`);
  const sounds = fs.readdirSync(path.join(ROOT, 'public', 'sounds')).filter(f => /\.(wav|mp3|ogg)$/i.test(f));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'sounds', 'list'), 'utf8')), sounds, 'same list server.js serves');
  const again = build(out, 'wss://holdout.example.org'); // rebuilding over an earlier build is fine
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(again.config, { static: true, server: 'wss://holdout.example.org' });
});

test('the solo worker\'s local server runs a fresh room over post(), like server.js does over a socket', async t => {
  const posts = [];
  const srv = startLocalServer(d => posts.push(d));
  t.after(() => srv.stop());
  const json = () => posts.filter(d => typeof d === 'string').map(s => JSON.parse(s));
  const last = type => json().filter(m => m.t === type).at(-1);

  srv.receive(JSON.stringify({ t: 'ready', on: true }));
  assert.equal(posts.length, 0, 'nothing but hello before joining');
  srv.receive(JSON.stringify({ t: 'hello', name: ' <Zed>&"Q ', mode: 'join', code: 'NOPE' }));
  const welcome = json()[0];
  assert.equal(welcome.t, 'welcome');
  assert.equal(welcome.code, 'SOLO', 'join codes are ignored: always a fresh room');
  assert.ok(last('inv') && last('sall') && last('spawn'), 'the usual join sync');
  assert.equal(last('hphase').phase, 'lobby');
  assert.equal(last('roster').players[0].name, 'ZedQ', 'names are cleaned like server.js does');

  srv.receive(JSON.stringify({ t: 'ready', on: true }));
  assert.equal(last('hphase').phase, 'countdown');
  assert.equal(last('roster').players[0].ready, true);
  srv.receive(JSON.stringify({ t: 'ping', ts: 42, ping: 7 }));
  assert.deepEqual(json().at(-1), { t: 'pong', ts: 42 }, 'the latency ping is answered');
  srv.receive(JSON.stringify({ t: 'ping', x: 1, z: 2 }));
  assert.deepEqual(json().at(-1), { t: 'ping', by: welcome.id, x: 1, z: 2 }, 'map pings still work');
  for (const junk of ['not json', 'null', '7']) srv.receive(junk);

  const z = srv.room.spawnZombie('shambler', 'N', '');
  await until(() => posts.some(d => d instanceof ArrayBuffer));
  const snap = posts.filter(d => d instanceof ArrayBuffer).at(-1);
  assert.ok(snap, 'zombie snapshots arrive as ArrayBuffers');
  const v = new DataView(snap);
  assert.equal(v.getUint8(0), 1);
  assert.equal(v.getUint16(2, true), 1);
  assert.equal(snap.byteLength, 12 + 14);
  assert.equal(v.getUint16(12, true), z.id);
  assert.deepEqual([v.getInt16(14, true), v.getInt16(18, true)], [Math.round(z.pos[0] * 100), Math.round(z.pos[2] * 100)]);
  assert.equal(v.getUint8(23), 255, 'full health');
  assert.ok(last('hstat'), 'the 30 Hz tick runs');

  srv.stop();
  const n = posts.length;
  await sleep(150);
  srv.receive(JSON.stringify({ t: 'ready', on: false }));
  assert.equal(posts.length, n, 'nothing is posted after stop()');
});
