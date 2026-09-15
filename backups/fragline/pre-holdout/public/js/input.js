// Keyboard/mouse state with pointer lock (raw input where supported).
// Everything is tracked as a "code": keyboard e.code (KeyW, Space, ControlLeft…), Mouse0-4, WheelUp/WheelDown.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();      // codes currently held
    this.pressed = [];          // press events since last frame (edges), incl. wheel ticks
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    this.active = false;        // true while in a match (captures game keys)
    this.captured = new Set();  // bound codes whose browser default we block in-game
    this.capture = null;        // set by the key-binding UI: receives the next code pressed
    this.onLockChange = null;

    addEventListener('keydown', e => {
      if (this.capture) { e.preventDefault(); e.stopPropagation(); this.takeCapture(e.code); return; }
      if (!this.active || e.target.tagName === 'INPUT') return;
      if (this.captured.has(e.code) || e.ctrlKey || e.code === 'Tab' || e.code === 'Escape') e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.keys.add(e.code);
    }, true);
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousedown', e => {
      const code = 'Mouse' + e.button;
      if (this.capture) { e.preventDefault(); this.takeCapture(code); return; }
      if (!this.locked) return;
      if (e.button !== 0) e.preventDefault(); // no autoscroll / back-forward navigation from side buttons
      this.keys.add(code);
      this.pressed.push(code);
    });
    addEventListener('mouseup', e => {
      this.keys.delete('Mouse' + e.button);
      if (this.active && e.button > 2) e.preventDefault();
    });
    addEventListener('contextmenu', e => { if (this.active || this.capture) e.preventDefault(); });
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    addEventListener('wheel', e => {
      if (!e.deltaY) return;
      const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
      if (this.capture) { this.takeCapture(code); return; }
      if (this.locked) this.pressed.push(code);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });
  }

  takeCapture(code) {
    const cb = this.capture;
    this.capture = null;
    cb(code);
  }

  lock() {
    const c = this.canvas;
    try {
      const p = c.requestPointerLock({ unadjustedMovement: true });
      if (p?.catch) p.catch(() => { try { c.requestPointerLock()?.catch?.(() => {}); } catch { /* ignore */ } });
    } catch {
      try { c.requestPointerLock(); } catch { /* ignore */ }
    }
  }

  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(code) { return this.keys.has(code); }
  takePressed() { const p = this.pressed; this.pressed = []; return p; }
  takeMouse() { const d = [this.dx, this.dy]; this.dx = this.dy = 0; return d; }
}
