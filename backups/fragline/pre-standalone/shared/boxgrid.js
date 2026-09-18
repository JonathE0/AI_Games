// Uniform XZ grid over axis-aligned boxes: answers "which boxes are near here" quickly, so dozens of
// zombies can collide against a map full of player-built pieces. The ground box is always returned.
export class BoxGrid {
  constructor(cell = 4) {
    this.cell = cell;
    this.cells = new Map();
    this.always = [];
    this.stamp = 0;
  }

  range(b) {
    const c = this.cell;
    return [Math.floor(b.min[0] / c), Math.floor(b.min[2] / c), Math.floor(b.max[0] / c), Math.floor(b.max[2] / c)];
  }

  add(b) {
    if (b.mat === 'f') { this.always.push(b); return; }
    const [i0, k0, i1, k1] = this.range(b);
    b._gk = [];
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
      const key = i * 4096 + k;
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, list = []);
      list.push(b);
      b._gk.push(key);
    }
  }

  remove(b) {
    const a = this.always.indexOf(b);
    if (a >= 0) this.always.splice(a, 1);
    for (const key of b._gk || []) {
      const list = this.cells.get(key), j = list ? list.indexOf(b) : -1;
      if (j >= 0) list.splice(j, 1);
    }
    b._gk = null;
  }

  // Boxes overlapping the XZ rectangle (plus the ground), without duplicates.
  query(x0, z0, x1, z1, out = []) {
    const st = ++this.stamp, c = this.cell;
    out.length = 0;
    for (const b of this.always) out.push(b);
    const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c), k0 = Math.floor(z0 / c), k1 = Math.floor(z1 / c);
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
      const list = this.cells.get(i * 4096 + k);
      if (list) for (const b of list) if (b._qs !== st) { b._qs = st; out.push(b); }
    }
    return out;
  }
}
