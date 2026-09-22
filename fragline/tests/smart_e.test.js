// Smart E: Use and Inventory may share one key (every other action keeps one key, one action); that key closes an
// open inventory, uses whatever is in range, and opens the inventory when there's nothing to use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// the browser serves shared/ at /shared/ — map that so hud.js imports unchanged
const ROOT = new URL('../', import.meta.url).href;
registerHooks({ resolve: (spec, ctx, next) => next(spec.startsWith('/shared/') ? ROOT + spec.slice(1) : spec, ctx) });
const { defaultBinds, leftHandedBinds, setBind, smartKey, smartRoute } = await import('../public/js/hud.js');

test('setBind lets Use and Inventory share a key; anything else still takes it from both', () => {
  for (const preset of [defaultBinds, leftHandedBinds]) {
    const b = preset();
    assert.notDeepEqual(b.interact[0], b.backpack[0], 'the presets keep them apart');
    assert.ok(!smartKey(b, b.interact[0]) && !smartKey(b, b.backpack[0]));
  }
  const b = defaultBinds();
  setBind(b, 'backpack', 0, 'KeyE');
  assert.deepEqual([b.interact[0], b.backpack[0]], ['KeyE', 'KeyE'], 'Inventory joins Use on E');
  assert.ok(smartKey(b, 'KeyE') && !smartKey(b, 'KeyI') && !smartKey(b, ''));
  setBind(b, 'interact', 1, 'KeyF'); // the other way round: Use takes a key from Floor, not from a shared pair
  assert.deepEqual([b.interact[1], b.bFloor[0]], ['KeyF', '']);
  setBind(b, 'backpack', 1, 'KeyF');
  assert.deepEqual([b.interact[1], b.backpack[1]], ['KeyF', 'KeyF']);
  setBind(b, 'reload', 1, 'KeyE'); // a third action takes E from both
  assert.deepEqual([b.interact[0], b.backpack[0], b.reload[1]], ['', '', 'KeyE']);
  assert.ok(!smartKey(b, 'KeyE'));
  setBind(b, 'map', 0, 'KeyI'); // and nothing else learned to share
  assert.deepEqual([b.map[0], b.backpack[0]], ['KeyI', '']);
});

test('the shared key: close an open inventory, else use what is in range (press, hold or keep holding), else open it', () => {
  assert.equal(smartRoute(true, { kind: 'pickup', press: true }), 'close');
  assert.equal(smartRoute(true, null), 'close');
  for (const it of [{ kind: 'pickup', press: true }, { kind: 'stash', press: true }, { kind: 'chest', hold: 0.8 }, { kind: 'revive', cont: true }, { kind: 'repair', cont: true }])
    assert.equal(smartRoute(false, it), 'use', it.kind);
  assert.equal(smartRoute(false, null), 'open', 'nothing in range');
  assert.equal(smartRoute(false, { kind: 'nopickup', text: 'Inventory full' }), 'open', 'a pickup that won\'t fit: open the inventory to make room');
  assert.equal(smartRoute(false, { kind: 'coreheal', text: 'The Core can only be repaired between waves' }), 'open', 'nothing to do there');
});
