// Zombie navigation: a 1 m grid with a Dijkstra "distance to the Core" field. Built pieces are passable
// at a cost (roughly the time it takes to smash them), so zombies take a short detour around a wall but
// break through the weakest point of a sealed fort — one deliberate gap turns into a funnel.

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
// Extra cells of walking per HP, per cell a piece covers (a wall covers two rows): breaking a full
// Zinkonium wall "costs" ~100 m of detour — a well-built fort funnels the horde to its gaps.
export const HP_COST = 1 / 15;

// Only things that stand in a walker's way count: floors (0.3 m) and roofs are ignored.
const blocksWalking = b => b.mat !== 'f' && b.min[1] < 1.6 && b.max[1] > 0.5;

export class FlowField {
  // bounds: { minX, maxX, minZ, maxZ }; statics: map boxes; core: { x, z, half }
  constructor(bounds, statics, core) {
    this.x0 = bounds.minX; this.z0 = bounds.minZ;
    this.nx = bounds.maxX - bounds.minX; this.nz = bounds.maxZ - bounds.minZ;
    const N = this.nx * this.nz;
    this.staticSolid = new Uint8Array(N);
    this.solid = new Uint8Array(N);
    this.cost = new Float32Array(N);
    this.sid = new Int32Array(N);
    this.dist = new Float64Array(N); // must match the heap keys exactly (float32 rounding re-expands nodes forever)
    this.next = new Int32Array(N);
    this.bdist = new Float64Array(N); // wall breakers: same solids, piece costs ignored ("as if builds weren't there")
    this.bnext = new Int32Array(N);
    for (const b of statics) if (blocksWalking(b)) this.cells(b, n => { this.staticSolid[n] = 1; });
    // goal = walkable ring of cells touching the Core
    this.goal = [];
    const g = core.half + 1.1;
    for (let n = 0; n < N; n++) {
      const [x, z] = this.center(n);
      if (!this.staticSolid[n] && Math.abs(x - core.x) < g && Math.abs(z - core.z) < g) this.goal.push(n);
    }
    this.update([], []);
  }

  idx(x, z) {
    const i = Math.floor(x - this.x0), k = Math.floor(z - this.z0);
    return i < 0 || k < 0 || i >= this.nx || k >= this.nz ? -1 : i + k * this.nx;
  }

  center(n) { return [this.x0 + (n % this.nx) + 0.5, this.z0 + Math.floor(n / this.nx) + 0.5]; }

  // every cell whose 1 m square overlaps the box footprint
  cells(b, fn) {
    const i0 = Math.max(0, Math.floor(b.min[0] - this.x0 - 0.5)), i1 = Math.min(this.nx - 1, Math.ceil(b.max[0] - this.x0 - 0.5));
    const k0 = Math.max(0, Math.floor(b.min[2] - this.z0 - 0.5)), k1 = Math.min(this.nz - 1, Math.ceil(b.max[2] - this.z0 - 0.5));
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
      const x = this.x0 + i + 0.5, z = this.z0 + k + 0.5;
      if (x + 0.5 > b.min[0] && x - 0.5 < b.max[0] && z + 0.5 > b.min[2] && z - 0.5 < b.max[2]) fn(i + k * this.nx);
    }
  }

  // nodes: alive harvest-node boxes; pieces: [{ id, hp, boxes }]. Rebuilds costs and the distance field.
  // Edited pieces only block where tiles remain (a door still blocks: zombies can't open it).
  update(nodes, pieces) {
    this.solid.set(this.staticSolid);
    this.cost.fill(0);
    this.sid.fill(-1);
    for (const b of nodes) this.cells(b, n => { this.solid[n] = 1; });
    const weakest = new Float32Array(this.sid.length).fill(Infinity), mark = new Uint32Array(this.sid.length);
    let stamp = 0;
    for (const s of pieces) {
      stamp++;
      for (const b of s.boxes ?? [s.box]) {
        if (!blocksWalking(b)) continue;
        this.cells(b, n => {
          if (mark[n] === stamp) return; // one piece counts once per cell
          mark[n] = stamp;
          this.cost[n] += Math.max(1, s.hp) * HP_COST;
          if (s.hp < weakest[n]) { weakest[n] = s.hp; this.sid[n] = s.id; }
        });
      }
    }
    this.compute();
    this.computeBreaker();
  }

  compute() { this.run(this.dist, this.next, false); }
  // ignorePieces: solids (statics + alive nodes) still block, but piece cost/blocking is skipped entirely —
  // wall breakers plan the shortest route to the Core as if nothing had been built.
  computeBreaker() { this.run(this.bdist, this.bnext, true); }

  run(dist, next, ignorePieces) {
    const { nx, nz, solid, cost } = this;
    dist.fill(Infinity);
    next.fill(-1);
    const heap = new Heap();
    for (const g of this.goal) { dist[g] = 0; heap.push(g, 0); }
    while (heap.size) {
      const d = heap.topKey(), n = heap.pop();
      if (d > dist[n]) continue;
      const ci = n % nx, ck = (n / nx) | 0;
      for (const [di, dk, len] of DIRS) {
        const i = ci + di, k = ck + dk;
        if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
        const m = i + k * nx;
        if (solid[m]) continue;
        if (di && dk) { // no squeezing diagonally past a corner (pieces only enforce this on the normal field)
          const a = ci + (ck + dk) * nx, b = ci + di + ck * nx;
          if (solid[a] || solid[b] || (!ignorePieces && (cost[a] || cost[b]))) continue;
        }
        // a zombie standing in m walks into n: pays the step plus smashing whatever is built in n
        const nd = d + len + (ignorePieces ? 0 : cost[n]);
        if (nd < dist[m]) { dist[m] = nd; next[m] = n; heap.push(m, nd); }
      }
    }
  }

  // Where a zombie at (x, z) should head: { x, z, sid (piece in the way or -1), here (piece in its own cell) }
  step(x, z) { return this.stepOn(x, z, this.dist, this.next); }
  // Same, but along the breaker field (piece costs ignored — see computeBreaker).
  bstep(x, z) { return this.stepOn(x, z, this.bdist, this.bnext); }

  stepOn(x, z, dist, next) {
    let n = this.idx(x, z);
    if (n < 0 || !isFinite(dist[n])) n = this.nearestReachable(x, z, dist);
    if (n < 0) return null;
    const m = next[n];
    if (m < 0) { const [cx, cz] = this.center(n); return { x: cx, z: cz, sid: -1, here: this.sid[n], goal: true }; }
    const [cx, cz] = this.center(m);
    return { x: cx, z: cz, sid: this.sid[m], here: this.sid[n], goal: false };
  }

  nearestReachable(x, z, dist = this.dist) {
    const i0 = Math.floor(x - this.x0), k0 = Math.floor(z - this.z0);
    for (let r = 1; r < 6; r++) for (let di = -r; di <= r; di++) for (let dk = -r; dk <= r; dk++) {
      if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
      const i = i0 + di, k = k0 + dk;
      if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) continue;
      const n = i + k * this.nx;
      if (isFinite(dist[n])) return n;
    }
    return -1;
  }

  // First piece along the path within `cells` steps (spitters shell it from range).
  pieceAhead(x, z, cells) {
    let n = this.idx(x, z);
    for (let s = 0; n >= 0 && s < cells; s++) {
      if (this.sid[n] >= 0) return this.sid[n];
      n = this.next[n];
    }
    return -1;
  }
}

// Binary min-heap of (node, key).
class Heap {
  constructor() { this.n = []; this.k = []; }
  get size() { return this.n.length; }
  topKey() { return this.k[0]; }
  push(node, key) {
    const n = this.n, k = this.k;
    let i = n.length;
    n.push(node); k.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      n[i] = n[p]; k[i] = k[p]; i = p;
    }
    n[i] = node; k[i] = key;
  }
  pop() {
    const n = this.n, k = this.k, top = n[0], lastN = n.pop(), lastK = k.pop();
    if (n.length) {
      let i = 0;
      const len = n.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lastK;
        if (l < len && k[l] < mk) { m = l; mk = k[l]; }
        if (r < len && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break;
        n[i] = n[m]; k[i] = k[m]; i = m;
      }
      n[i] = lastN; k[i] = lastK;
    }
    return top;
  }
}
