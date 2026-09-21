// Static solo build for Netlify or any static host: the client, the shared rules and the Holdout room in one folder.
// With no game server the room runs in a Web Worker (public/js/local/). Every build re-walks the browser's module
// graph, so a file the game needs can't silently go missing from the deploy.
// Usage: node scripts/build-static.mjs [--out dir] [--list]   (--list prints every module the walk reached)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), outAt = argv.indexOf('--out');
const OUT = path.resolve(outAt >= 0 && argv[outAt + 1] ? argv[outAt + 1] : path.join(ROOT, 'dist'));
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const die = msg => { console.error(`build-static: ${msg}`); process.exit(1); };
const within = (p, dir) => { const r = path.relative(dir, p); return !r || (!r.startsWith('..') && !path.isAbsolute(r)); };

// ---------- clean (carefully: this deletes the whole folder) ----------
if (!fs.existsSync(path.join(THREE_DIR, 'build', 'three.module.js'))) die('three is not installed: run npm install first');
if (within(ROOT, OUT)) die(`refusing to build into ${OUT}: it contains the project`);
for (const d of ['public', 'shared', 'server', 'node_modules']) if (within(OUT, path.join(ROOT, d))) die(`refusing to build inside ${d}/`);
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length && !fs.existsSync(path.join(OUT, 'js', 'local', 'worker.js')))
  die(`refusing to clean ${OUT}: it isn't empty and doesn't look like an earlier static build`);
fs.rmSync(OUT, { recursive: true, force: true });

// ---------- copy: the same layout server.js serves (/ = public, /shared/, /lib/three/) plus the room ----------
const copy = (from, to) => {
  const dst = path.join(OUT, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(path.join(ROOT, from), dst, { recursive: true });
};
copy('public', '.');
copy('shared', 'shared');
copy('server/baseRoom.js', 'server/baseRoom.js');
copy('server/holdout', 'server/holdout');
for (const f of ['three.module.js', 'three.core.js']) copy(`node_modules/three/build/${f}`, `lib/three/build/${f}`);
fs.writeFileSync(path.join(OUT, 'config.js'), '// written by scripts/build-static.mjs\n' +
  `window.FRAGLINE_CONFIG = { static: true, server: ${JSON.stringify(process.env.HOLDOUT_SERVER_URL || null)} };\n`);
let sounds = []; // what server.js answers on /sounds/list
try { sounds = fs.readdirSync(path.join(ROOT, 'public', 'sounds')).filter(f => /\.(wav|mp3|ogg)$/i.test(f)); } catch { /* no folder */ }
fs.mkdirSync(path.join(OUT, 'sounds'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'sounds', 'list'), JSON.stringify(sounds));

// ---------- verify: walk the module graph the way a browser resolves it ----------
const ORIGIN = 'http://static.invalid', PAGE = new URL('/index.html', ORIGIN);
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] || '{}').imports || {};
const relOf = u => decodeURIComponent(u.pathname).slice(1);
const dirs = new Map();
const entries = d => { if (!dirs.has(d)) { let e = null; try { e = new Set(fs.readdirSync(d)); } catch { /* none */ } dirs.set(d, e); } return dirs.get(d); };
// exact-case lookup: Windows forgives 'Foo.js' for 'foo.js', a Linux host doesn't
const exists = rel => {
  let p = OUT;
  for (const part of rel.split('/')) { if (!entries(p)?.has(part)) return false; p = path.join(p, part); }
  return fs.statSync(p).isFile();
};
// three addons are copied only when the graph reaches them
const pullThree = rel => {
  if (!rel.startsWith('lib/three/')) return;
  const src = path.join(THREE_DIR, ...rel.slice('lib/three/'.length).split('/'));
  if (!within(src, THREE_DIR) || !fs.statSync(src, { throwIfNoEntry: false })?.isFile()) return;
  fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
  fs.copyFileSync(src, path.join(OUT, rel));
  dirs.clear();
};
// specifier -> URL, or an error string. Workers get no import map, so a bare specifier there is an error.
const resolve = (spec, base, page) => {
  if (/^\.{0,2}\//.test(spec) || /^[a-z][a-z\d+.-]*:/i.test(spec)) return new URL(spec, base);
  if (!page) return `bare import '${spec}' in worker code (workers have no import map)`;
  if (imports[spec]) return new URL(imports[spec], PAGE);
  const key = Object.keys(imports).filter(k => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return key ? new URL(imports[key] + spec.slice(key.length), PAGE) : `bare import '${spec}' isn't in index.html's import map`;
};
const IMPORT_RES = [
  /^[ \t]*(?:import|export)[\s{*][\w$\s{},*]*?\bfrom\s*(['"])([^'"\n]+)\1/gm, // import … from '…' · export … from '…'
  /^[ \t]*import\s*(['"])([^'"\n]+)\1/gm, // import '…'
  /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g, // import('…')
];
const WORKER_RE = /\bnew\s+(?:Shared)?Worker\s*\(\s*(['"])([^'"\n]+)\1/g; // resolved against the page, not the module

const problems = [], modules = new Set(), seen = new Set(), queue = [];
const visit = (url, page, by) => {
  if (url.origin !== ORIGIN || seen.has(`${page}${url.pathname}`)) return;
  seen.add(`${page}${url.pathname}`);
  queue.push({ url, page, by });
};
for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) {
  const u = new URL(m[1], PAGE);
  if (u.origin === ORIGIN && !exists(relOf(u))) problems.push(`missing ${relOf(u)} (index.html)`);
}
for (const m of html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)) visit(new URL(m[1], PAGE), true, 'index.html');
visit(new URL('/js/main.js', PAGE), true, 'index.html');
visit(new URL('/js/local/worker.js', PAGE), false, 'js/net.js');
while (queue.length) {
  const { url, page, by } = queue.shift(), rel = relOf(url);
  if (!exists(rel)) pullThree(rel);
  if (!exists(rel)) { problems.push(`missing ${rel} (imported by ${by})`); continue; }
  modules.add(rel);
  const src = fs.readFileSync(path.join(OUT, rel), 'utf8');
  for (const re of IMPORT_RES) for (const m of src.matchAll(re)) {
    const r = resolve(m[2], url, page);
    if (typeof r === 'string') problems.push(`${rel}: ${r}`);
    else visit(r, page, rel);
  }
  for (const m of src.matchAll(WORKER_RE)) visit(new URL(m[2], PAGE), false, rel);
}
if (problems.length) die(`the static build is broken:\n  ${[...new Set(problems)].join('\n  ')}`); // page and worker may both report one

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(OUT), bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
if (argv.includes('--list')) for (const m of [...modules].sort()) console.log(m);
console.log(`static build ok: ${within(OUT, ROOT) ? path.relative(ROOT, OUT) : OUT} · ${files.length} files · ` +
  `${(bytes / 1048576).toFixed(2)} MB · ${modules.size} modules checked`);
