import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';

function join(room) {
  const messages = [];
  const player = room.addPlayer({ readyState: 1, send: s => messages.push(JSON.parse(s)) }, 'Tester');
  return { player, messages };
}

test('custom room welcomes guests with its mode and gives fresh snipers every spawn', () => {
  const room = new Room('TEST', { gameMode: 'scoutsman' });
  const { player, messages } = join(room);
  assert.equal(messages[0].gameMode, 'scoutsman');
  assert.equal(player.s1?.w, 'ssg08');
  assert.equal(player.s2, null);
  assert.equal(player.armor, 100);
  const old = player.s1.uid;
  room.spawn(player);
  assert.notEqual(player.s1.uid, old);
  room.onBuy(player, 'awp');
  assert.equal(player.s1.w, 'ssg08');
  const guest = join(room);
  assert.equal(guest.messages[0].gameMode, 'scoutsman');
  room.startRound();
  for (const p of room.players) assert.equal(p.s1.w, 'ssg08');
  assert.equal(room.canBuy(player), false);
});

test('classic rooms keep their ordinary equipment and buying', () => {
  const room = new Room('TEST');
  const { player } = join(room);
  assert.equal(player.s1, null);
  assert.equal(player.s2.w, 'glock');
  assert.equal(room.canBuy(player), true);
});
