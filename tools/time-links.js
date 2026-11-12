// Måler et gennemløb af addLinks på en given bane: node tools/time-links.js [lager] [B] [H] [antal]
const path = require('path');
const dir = path.join(__dirname, '..', 'static', 'js');
for (const f of ['core', 'graph', 'lattice', 'topologies', 'elements', 'router', 'generator']) require(path.join(dir, f + '.js'));
const MK = globalThis.MK, C = MK.core, R = MK.router;
const inv = { '24188': 57, '24172': 37, '24077': 3, '24977': 2, '24130': 44, '24230': 12, '24330': 6, '24224': 3, '24611': 1, '24612': 2, '24671': 4, '24672': 4, '24630': 1, '24640': 1, '24649': 1 };
const [W, H, n] = [+(process.argv[2] || 3000), +(process.argv[3] || 1500), +(process.argv[4] || 12)];
const o = { W, H, margin: 50, maximize: true, debug: false };
const loopT = MK.topologies.find(t => t.id === 'loop');
let tot = 0, cnt = 0, found = 0, mx = 0;
for (let seed = 1; cnt < n && seed < 400; seed++) {
  const rng = C.mulberry32(seed);
  const att = loopT.attempt({ ...inv }, { W, H, sCurves: seed % 2 === 0, seedPairs: 1, slimSeed: false, stationTracks: 1 }, rng, loopT.prep(inv), {});
  if (!att) continue;
  att.chains.forEach(C.layoutChain);
  const bb = C.bbox(att.chains[0].samples);
  if (bb.w > W - 150 || bb.h > H - 150) continue;
  att.chains[0].start = { x: 50 + 25 - bb.x0, y: 50 + 25 - bb.y0, h: 0 }; C.layoutChain(att.chains[0]);
  const layout = { chains: att.chains, sides: [] };
  const stats = {};
  const t0 = process.hrtime.bigint();
  const got = R.addLinks(layout, inv, o, mulberry(seed), 1, { stats });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  tot += ms; mx = Math.max(mx, ms); cnt++; found += got;
  console.log(seed, att.name, 'ms', ms.toFixed(0), 'fundet', got, JSON.stringify(stats));
}
function mulberry(a) { return C.mulberry32(a * 7 + 1); }
console.log(`gennemsnit ${(tot / cnt).toFixed(0)} ms, maks ${mx.toFixed(0)} ms, ${found}/${cnt} med forbindelse`);
