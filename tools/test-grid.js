// Test: den nye talnøglede C.Grid giver samme svar som den gamle strengnøglede på 1000 tilfældige opslag.
const path = require('path');
const dir = path.join(__dirname, '..', 'static', 'js');
require(path.join(dir, 'core.js'));
const C = globalThis.MK.core;
class OldGrid {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  add(p) { const k = Math.floor(p.x / this.cell) + ',' + Math.floor(p.y / this.cell); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(p); }
  near(x, y, fn) {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = this.m.get((cx + i) + ',' + (cy + j)); if (a) for (const p of a) if (fn(p) === true) return true; }
    return false;
  }
}
const rng = C.mulberry32(7);
let bad = 0;
for (const cell of [40, 75, 20]) {
  const a = new C.Grid(cell), b = new OldGrid(cell), pts = [];
  for (let i = 0; i < 3000; i++) { const p = { x: rng() * 5000 - 300, y: rng() * 3000 - 300, i }; pts.push(p); a.add(p); b.add(p); }
  for (let t = 0; t < 1000; t++) {
    const x = rng() * 5000 - 300, y = rng() * 3000 - 300, r = 5 + rng() * cell;
    const ha = [], hb = [];
    a.near(x, y, p => { if (Math.hypot(p.x - x, p.y - y) < r) ha.push(p.i); return false; });
    b.near(x, y, p => { if (Math.hypot(p.x - x, p.y - y) < r) hb.push(p.i); return false; });
    if (ha.sort().join() !== hb.sort().join()) bad++;
    if (a.near(x, y, p => Math.hypot(p.x - x, p.y - y) < r) !== b.near(x, y, p => Math.hypot(p.x - x, p.y - y) < r)) bad++;
  }
}
console.log(bad ? 'FEJL ' + bad : 'OK');
process.exit(bad ? 1 : 0);
