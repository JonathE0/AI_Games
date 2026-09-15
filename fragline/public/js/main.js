// Entry point: menu wiring + render loop.
import { Game } from './game.js';
import { recordText } from './holdout_ui.js';

const $ = id => document.getElementById(id);
const game = new Game($('game'));
window.fragline = game; // handy for debugging in the console

$('nameInput').value = game.hud.settings.name || '';
const hash = location.hash.slice(1).toUpperCase();
if (/^[A-Z]{4}$/.test(hash)) $('codeInput').value = hash;

$('btnQuick').onclick = () => game.start('quick');
$('btnHuntsman').onclick = () => game.start('create', { gameMode: 'scoutsman' });
$('btnHoldout').onclick = () => game.start('create', { gameMode: 'zombies' });
$('hoBest').textContent = recordText();
$('btnCreate').onclick = () => game.start('create');
$('btnJoin').onclick = () => {
  const code = $('codeInput').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { $('menuMsg').textContent = 'Enter the 4-letter room code'; return; }
  game.start('join', { code });
};
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
$('btnBot').onclick = () => game.start('bot', { diff: $('diffSelect').value });
$('btnResume').onclick = () => game.resume();
$('btnLeave').onclick = () => game.leave();
$('game').addEventListener('click', () => { if (game.inGame && !game.ui && !game.input.locked) game.resume(); });
$('chatInput').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = e.target.value.trim();
    if (text) game.net.send({ t: 'chat', text });
    game.closeChat();
  } else if (e.key === 'Escape') game.closeChat();
});

let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
  last = t;
  game.now = t / 1000;
  game.frame(dt);
}
requestAnimationFrame(frame);
