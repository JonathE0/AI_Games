// Key bindings: the right- and left-handed presets, one key per action (Rotate may share), and loading older saves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// the browser serves shared/ at /shared/ — map that so hud.js imports unchanged
const ROOT = new URL('../', import.meta.url).href;
registerHooks({ resolve: (spec, ctx, next) => next(spec.startsWith('/shared/') ? ROOT + spec.slice(1) : spec, ctx) });
const { ACTIONS, BUILD_ACTIONS, BINDS_VERSION, defaultBinds, leftHandedBinds, loadBinds, setBind, keyName } = await import('../public/js/hud.js');

const ids = ACTIONS.map(a => a[0]);
const PRESETS = { right: defaultBinds(), left: leftHandedBinds() };

test('each preset binds every action exactly once, and walk / demolish / heal / build mode are gone', () => {
  assert.equal(new Set(ids).size, ids.length, 'no action listed twice');
  for (const [name, binds] of Object.entries(PRESETS)) {
    assert.deepEqual(Object.keys(binds).sort(), [...ids].sort(), name);
    for (const codes of Object.values(binds)) assert.equal(codes.length, 2);
  }
  for (const gone of ['walk', 'demolish', 'heal', 'build']) assert.ok(!ids.includes(gone), gone);
  for (const id of ['bWall', 'bFloor', 'bStair', 'bCone', 'bTrap', 'bDeploy', 'bRotate']) assert.ok(BUILD_ACTIONS.has(id), id);
});

test('no key does two things in either preset — only Rotate (building only) and the Ronin\'s dash (on hotbar slot 4) may share one', () => {
  for (const [name, binds] of Object.entries(PRESETS)) {
    const codes = ids.filter(id => id !== 'bRotate' && id !== 'dash').flatMap(id => binds[id]).filter(Boolean);
    assert.deepEqual(codes.filter((c, i) => codes.indexOf(c) !== i), [], name);
    assert.deepEqual(binds.dash, binds.slot4, `${name}: the dash sits on hotbar slot 4's key`);
  }
  assert.deepEqual([PRESETS.right.bRotate[0], PRESETS.right.reload[0]], ['KeyR', 'KeyR'], 'R rotates while building, reloads otherwise');
});

test('the right-handed preset matches the Fortnite-style layout; left-handed moves build keys to the right hand', () => {
  const first = b => Object.fromEntries(Object.entries(b).map(([id, c]) => [id, c[0]]));
  assert.deepEqual(first(PRESETS.right), {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'ControlLeft', fire: 'Mouse0', alt: 'Mouse2',
    reload: 'KeyR', inspect: 'KeyX', primary: 'Digit1', secondary: 'Digit2', knife: 'Digit3', slot4: 'Digit4', slot5: 'Digit5', slot6: 'Digit6', dash: 'Digit4',
    lastWeapon: '', nextWeapon: 'WheelDown', prevWeapon: 'WheelUp', buy: 'KeyB', scoreboard: 'Tab', chat: 'Enter', edit: 'KeyG',
    interact: 'KeyE', ready: 'KeyY', throw: 'KeyT', nextThrow: 'KeyN', adrenaline: 'KeyH', sack1: 'Digit7', sack2: 'Digit8', sack3: 'Digit9',
    sack4: 'Digit0', flashlight: 'KeyL', backpack: 'KeyI', map: 'KeyM', bWall: 'KeyQ', bFloor: 'KeyF', bStair: 'KeyC', bCone: 'ShiftLeft',
    bTrap: 'KeyZ', bDeploy: 'KeyV', bRotate: 'KeyR', turretUp: 'KeyU',
  });
  assert.ok(Object.values(PRESETS.right).every(c => !c[1]), 'no alternates (crouch is Ctrl only)');
  const L = first(PRESETS.left);
  assert.deepEqual([L.bWall, L.bFloor, L.bStair, L.bCone, L.bTrap, L.bDeploy, L.bRotate, L.edit, L.ready, L.map],
    ['KeyP', 'KeyM', 'Comma', 'Period', 'KeyT', 'KeyH', 'KeyR', 'KeyJ', 'KeyR', 'KeyZ']);
  assert.equal(L.turretUp, 'Quote', 'Upgrade turret: U right-handed, Quote left-handed');
});

test('hotbar labels, handed defaults and readable key names', () => {
  const label = Object.fromEntries(ACTIONS);
  assert.deepEqual(['primary', 'secondary', 'knife', 'slot4', 'slot5', 'slot6'].map(id => label[id]), [1, 2, 3, 4, 5, 6].map(n => `Hotbar slot ${n}`));
  assert.equal(label.inspect, 'Harvest tool');
  assert.deepEqual(PRESETS.right.adrenaline, ['KeyH', '']);
  assert.deepEqual(PRESETS.left.forward, ['KeyO', '']);
  assert.deepEqual(PRESETS.left.crouch, ['ControlLeft', 'KeyC']);
  assert.deepEqual(PRESETS.left.chat, ['', '']);
  assert.deepEqual(['Minus', 'Equal', 'Semicolon', 'Comma', 'Period', 'BracketRight', 'Backslash', 'Enter', 'KeyO', 'Digit0', 'ShiftLeft'].map(keyName),
    ['-', '=', ';', ',', '.', ']', '\\', 'Enter', 'O', '0', 'L-Shift']);
});

test('rebinding clears the key from every other action, except Rotate which may share it', () => {
  let b = defaultBinds();
  setBind(b, 'bWall', 0, 'KeyW'); // building keys work anytime: movement loses W
  assert.deepEqual([b.bWall[0], b.forward[0]], ['KeyW', '']);
  setBind(b, 'bRotate', 0, 'KeyE'); // rotate only acts while building, so interact keeps E
  assert.deepEqual([b.bRotate[0], b.interact[0]], ['KeyE', 'KeyE']);
  b = defaultBinds();
  setBind(b, 'interact', 1, 'KeyR'); // reload loses R, rotate keeps it
  assert.deepEqual([b.interact[1], b.reload[0], b.bRotate[0]], ['KeyR', '', 'KeyR']);
  setBind(b, 'edit', 0, 'KeyQ'); // and Edit takes Q off the wall
  assert.deepEqual([b.edit[0], b.bWall[0]], ['KeyQ', '']);
  setBind(b, 'forward', 1, ''); // clearing a slot touches nothing else
  assert.deepEqual(b.back, ['KeyS', '']);
});

test('binds saved before the building keys went anytime reset to the right-handed preset; current saves load over the defaults', () => {
  const old = { walk: ['ShiftLeft', ''], build: ['KeyG', ''], adrenaline: ['KeyJ'], forward: ['ArrowUp', 'KeyW'] };
  for (const v of [undefined, 1]) assert.deepEqual(loadBinds(old, v), defaultBinds(), `version ${v}`);
  const b = loadBinds(old, BINDS_VERSION);
  assert.deepEqual(Object.keys(b).sort(), [...ids].sort(), 'removed actions dropped');
  assert.deepEqual(b.forward, ['ArrowUp', 'KeyW']);
  assert.deepEqual(b.adrenaline, ['KeyJ', '']); // your own binding carries over
  assert.deepEqual(b.bCone, ['ShiftLeft', '']); // a new action keeps its default
  assert.deepEqual(loadBinds(null, BINDS_VERSION), defaultBinds());
});

test('a save from before a new action picks up that action on a free key (left-handed saves too)', () => {
  const strip = b => Object.fromEntries(Object.entries(b).filter(([id]) => id !== 'dash' && id !== 'turretUp'));
  const left = loadBinds(strip(leftHandedBinds()), BINDS_VERSION), right = loadBinds(strip(defaultBinds()), BINDS_VERSION);
  assert.deepEqual(left.turretUp, leftHandedBinds().turretUp, 'left-handed save gets the left-handed Upgrade turret key');
  assert.equal(left.dash[0], leftHandedBinds().slot4[0], 'the dash shares the save\'s Hotbar slot 4 key');
  assert.deepEqual(right.turretUp, defaultBinds().turretUp);
  assert.equal(right.dash[0], defaultBinds().slot4[0]);
});

test('a version-2 save keeps its keys but re-picks Dash and Upgrade turret (they may have been saved blank)', () => {
  const v2 = { ...leftHandedBinds(), dash: ['', ''], turretUp: ['', ''] };
  const b = loadBinds(v2, 2);
  assert.deepEqual(b.forward, leftHandedBinds().forward, 'the rest of the save is kept');
  assert.equal(b.dash[0], leftHandedBinds().slot4[0]);
  assert.deepEqual(b.turretUp, leftHandedBinds().turretUp);
});
