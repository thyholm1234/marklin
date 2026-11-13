// Test: nye walkGeo (cachede lokale punkter) afviger højst 1e-9 mm fra den gamle beregning.
const path = require('path');
require(path.join(__dirname, '..', 'static', 'js', 'core.js'));
const C = globalThis.MK.core;
const rng = C.mulberry32(11);
let worst = 0, bad = 0;
const geos = [];
for (let i = 0; i < 400; i++) {
  const k = rng();
  if (k < 0.3) geos.push(C.lineG(5 + rng() * 400));
  else if (k < 0.9) { const r = C.RADII[Math.floor(rng() * 5)]; geos.push(C.arcG(rng() < 0.5 ? 1 : -1, [7.5, 15, 24.28, 30, 5.72, 12.1][Math.floor(rng() * 6)], r)); }
  else geos.push({ kind: 'path', geos: [C.lineG(77.5), C.arcG(rng() < 0.5 ? 1 : -1, 30, C.R1)] });
}
for (const g of geos) for (let t = 0; t < 10; t++) {
  const st = { x: rng() * 3000 - 500, y: rng() * 2000 - 500, h: rng() * 720 - 360 };
  const a = C.walkGeo(st, g), b = C.walkGeoOld(st, g);
  if (a.pts.length !== b.pts.length) { bad++; continue; }
  for (let i = 0; i < a.pts.length; i++) for (const k of ['x', 'y', 'h']) worst = Math.max(worst, Math.abs(a.pts[i][k] - b.pts[i][k]));
  for (const k of ['x', 'y', 'h']) worst = Math.max(worst, Math.abs(a.end[k] - b.end[k]));
}
// tid
let t0 = process.hrtime.bigint();
for (let r = 0; r < 400; r++) for (const g of geos) C.walkGeoOld({ x: 1, y: 2, h: 33 }, g);
const to = Number(process.hrtime.bigint() - t0) / 1e6;
t0 = process.hrtime.bigint();
for (let r = 0; r < 400; r++) for (const g of geos) C.walkGeo({ x: 1, y: 2, h: 33 }, g);
const tn = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`største afvigelse ${worst.toExponential(2)}, gammel ${to.toFixed(0)} ms, ny ${tn.toFixed(0)} ms, faktor ${(to / tn).toFixed(1)}`);
console.log(bad || worst > 1e-9 ? 'FEJL' : 'OK');
process.exit(bad || worst > 1e-9 ? 1 : 0);
