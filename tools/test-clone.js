// Test: C.cloneLayout / cloneChains giver samme data som structuredClone, uden delt tilstand, og er hurtigere.
// node tools/test-clone.js
const path = require('path');
const dir = path.join(__dirname, '..', 'static', 'js');
for (const f of ['core', 'graph', 'lattice', 'topologies', 'elements', 'router', 'generator']) require(path.join(dir, f + '.js'));
const MK = globalThis.MK, C = MK.core;
const inv = { '24188': 57, '24172': 37, '24077': 3, '24977': 2, '24130': 44, '24230': 12, '24330': 6, '24224': 3, '24611': 1, '24612': 2, '24671': 4, '24672': 4, '24630': 1, '24640': 1, '24649': 1 };
let fails = 0;
const eq = (a, b, p) => {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) < 1e-9) return true; }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { if (fails++ < 10) console.log('  forskel', p, a, b); return false; }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) { if (fails++ < 10) console.log('  nøgler', p, ka.join(), '|', kb.join()); return false; }
  return ka.every(k => eq(a[k], b[k], p + '.' + k));
};
const layouts = [];
for (let k = 0; k < 6; k++) {
  const tp = ['loop', 'dogbone', 'p2p', 'figure8'];
  const res = MK.generate({ ...inv }, { W: 3000, H: 1500, margin: 50, maximize: true, stationTracks: 2, point: { x: 1500, y: 50 }, timeBudget: 700, seed: 99 + k * 7,
    topologies: Object.fromEntries(tp.map(t => [t, t === tp[k % 4]])) });
  if (!res.error) layouts.push({ chains: res.chains, sides: res.sides });
}
console.log('baner:', layouts.length);
for (const L of layouts) {
  const a = C.cloneLayout(L), b = structuredClone(L);
  eq(a, b, 'layout');
  // delt tilstand: ændringer i klonen må ikke ramme originalen
  const before = JSON.stringify(L);
  a.chains.forEach(ch => { ch.pieces.forEach(p => { p.art = 'x'; p.geo.len = -1; if (p.branch) p.branch.dir = 99; p.pts.push({ x: 1, y: 1 }); p.start.x += 5; }); ch.samples.push({}); ch.start.x += 1; });
  a.sides.forEach(sd => { sd.pts.push({ x: 0, y: 0 }); sd.pieces.forEach(p => { p.art = 'y'; p.pts.length = 0; }); });
  if (JSON.stringify(L) !== before) { console.log('  FEJL: klonen deler tilstand med originalen'); fails++; }
  // delte referencer genskabt
  const c2 = C.cloneChains(L.chains);
  c2.forEach(ch => ch.pieces.forEach((p, i) => { if (i && p.start !== ch.pieces[i - 1].end) { fails++; console.log('  FEJL: start !== forrige end'); } }));
  c2.forEach(ch => { if (ch.attach !== undefined && ch.start !== c2[ch.attach].end) { fails++; console.log('  FEJL: attach'); } });
}
// tid
const L = layouts[0], N = 300;
let t = process.hrtime.bigint();
for (let i = 0; i < N; i++) structuredClone(L);
const tS = Number(process.hrtime.bigint() - t) / 1e6 / N;
t = process.hrtime.bigint();
for (let i = 0; i < N; i++) C.cloneLayout(L);
const tC = Number(process.hrtime.bigint() - t) / 1e6 / N;
console.log(`structuredClone ${tS.toFixed(3)} ms, cloneLayout ${tC.toFixed(3)} ms, faktor ${(tS / tC).toFixed(1)}`);
console.log(fails ? 'FEJL ' + fails : 'OK');
process.exit(fails ? 1 : 0);
