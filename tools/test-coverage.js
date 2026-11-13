// Test: nye freeSpaceCoverage/spaceCoverage giver samme tal som de gamle (fra før generator v2) på 20 tilfældige punktsæt.
const path = require('path');
const dir = path.join(__dirname, '..', 'static', 'js');
for (const f of ['core', 'graph', 'lattice', 'topologies', 'elements', 'router', 'generator']) require(path.join(dir, f + '.js'));
const MK = globalThis.MK, C = MK.core, G = MK.compose;
function oldSpace(points, o) {
  if (!points.length) return 0;
  const targets = [{ x: o.margin, y: o.margin }, { x: o.W - o.margin, y: o.margin }, { x: o.margin, y: o.H - o.margin }, { x: o.W - o.margin, y: o.H - o.margin }, ...(o.areas || []).flat()];
  let score = 0;
  for (const t of targets) { let d = Infinity; for (const p of points) d = Math.min(d, Math.hypot(p.x - t.x, p.y - t.y)); score += Math.max(0, 1 - d / 700); }
  return score / targets.length;
}
function oldFree(points, o) {
  if (!points.length || !o.areas || !o.areas.length) return 0;
  const inside = (p, poly) => { let yes = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) yes = !yes; } return yes; };
  const free = [];
  for (let x = o.margin; x <= o.W - o.margin; x += 200) for (let y = o.margin; y <= o.H - o.margin; y += 200) if (!(o.areas || []).some(a => inside({ x, y }, a))) free.push({ x, y });
  if (!free.length) return 0;
  let covered = 0;
  for (const q of free) { let near = Infinity; for (const p of points) near = Math.min(near, Math.hypot(p.x - q.x, p.y - q.y)); if (near < 110) covered++; }
  return covered / free.length;
}
const rng = C.mulberry32(5);
let bad = 0;
for (let t = 0; t < 20; t++) {
  const o = { W: 3000, H: 1500, margin: 50, areas: [[{ x: 2000, y: 900 }, { x: 3000, y: 900 }, { x: 3000, y: 1500 }, { x: 2000, y: 1500 }]] };
  if (t % 3 === 0) o.areas.push([{ x: 100, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 500 }]);
  const pts = []; const n = 50 + Math.floor(rng() * 900);
  for (let i = 0; i < n; i++) pts.push({ x: rng() * 3000, y: rng() * 1500 });
  const a = G.freeSpaceCoverage(pts, o), b = oldFree(pts, o), c = G.spaceCoverage(pts, o), d = oldSpace(pts, o);
  if (Math.abs(a - b) > 1e-12 || Math.abs(c - d) > 1e-9) { bad++; console.log('forskel', t, a, b, c, d); }
}
console.log(bad ? 'FEJL ' + bad : 'OK');
process.exit(bad ? 1 : 0);
