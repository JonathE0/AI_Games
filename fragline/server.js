// Fragline server: serves the browser client and runs Zombie Holdout rooms over WebSockets.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { HoldoutRoom } from './server/holdout/room.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};
const MOUNTS = [
  ['/lib/three/', path.join(ROOT, 'node_modules', 'three') + path.sep],
  ['/shared/', path.join(ROOT, 'shared') + path.sep],
  ['/', path.join(ROOT, 'public') + path.sep],
];
const SOUND_DIR = path.join(ROOT, 'public', 'sounds');

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { url = '/'; }
  if (url === '/sounds/list') {
    let files = [];
    try { files = fs.readdirSync(SOUND_DIR).filter(f => /\.(wav|mp3|ogg)$/i.test(f)); } catch { /* no folder */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(files));
  }
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    let file = path.join(dir, url.slice(prefix.length) || 'index.html');
    if (!file.startsWith(dir)) break; // path traversal
    return fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (err2, data) => {
        if (err2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      });
    });
  }
  res.writeHead(404);
  res.end('Not found');
});

const rooms = new Map();
const newCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do c = Array.from({ length: 4 }, () => A[(Math.random() * A.length) | 0]).join('');
  while (rooms.has(c));
  return c;
};

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  let room = null, player = null;
  const fail = text => ws.send(JSON.stringify({ t: 'err', text }));

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (room) return room.handle(player, m);
    if (m.t !== 'hello') return;
    const name = String(m.name || '').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Player';
    if (m.mode === 'join') {
      const code = String(m.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return fail(`Room ${code || '(blank)'} not found`);
      if (r.isFull()) return fail(`Room ${code} is full`);
      room = r;
    } else if (m.mode === 'quick') {
      room = [...rooms.values()].find(r => r.public && !r.isFull());
      if (!room) { room = new HoldoutRoom(newCode()); room.public = true; rooms.set(room.code, room); }
    } else {
      room = new HoldoutRoom(newCode());
      rooms.set(room.code, room);
    }
    player = room.addPlayer(ws, name);
    console.log(`[${room.code}] ${name} joined (${room.players.length}/${room.maxPlayers})`);
  });

  ws.on('close', () => {
    if (!room || !player) return;
    room.removePlayer(player);
    console.log(`[${room.code}] ${player.name} left`);
    if (!room.players.length) rooms.delete(room.code);
  });
});

let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const r of rooms.values()) r.update(now, dt);
}, 1000 / 30);

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Fragline is running:\n  This PC:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Your LAN: http://${ip}:${PORT}`);
});
