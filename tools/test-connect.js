// Sammenligner den gamle ruteløser (solve + buildLink) med connect på tilfældige portpar på en oval.
// node tools/test-connect.js [antal par]
const path = require('path');
const dir = path.join(__dirname, '..', 'static', 'js');
for (const f of ['core', 'graph', 'lattice', 'topologies', 'elements', 'router', 'generator']) require(path.join(dir, f + '.js'));
const MK = globalThis.MK, C = MK.core, R = MK.router;
const N = +(process.argv[2] || 200);
const inv = { '24188': 57, '24172': 37, '24077': 3, '24977': 2, '24130': 44, '24230': 12, '24330': 6, '24224': 3, '24611': 1, '24612': 2, '24671': 4, '24672': 4, '24630': 1, '24640': 1, '24649': 1 };
// deterministiske ovaler (grundformen "loop" med fast seed), lagt midt på pladen
const loopT = MK.topologies.find(t => t.id === 'loop');
const WW = 3000, HH = 1500;
function makeOval(seed) {
  const rng = C.mulberry32(seed);
  for (let t = 0; t < 4000; t++) {
    const att = loopT.attempt({ ...inv }, { W: WW, H: HH, sCurves: false, seedPairs: 1, slimSeed: false, stationTracks: 1 }, rng, loopT.prep(inv), {});
    if (!att || att.name !== 'Oval') continue;
    att.chains.forEach(C.layoutChain);
    const bb = C.bbox(att.chains[0].samples);
    if (bb.w > WW - 200 || bb.h > HH - 200) continue;
    att.chains[0].start = { x: 100 - bb.x0 + 50, y: 50 - bb.y0 + 50, h: 0 };
    C.layoutChain(att.chains[0]);
    return { chains: att.chains, stats: { name: att.name, piecesUsed: att.chains[0].pieces.length } };
  }
}
const res = makeOval(+(process.env.SEED || 1));
const layout = { chains: res.chains, sides: res.sides };
const o = { W: 3000, H: 1500, margin: 50 };
const spare = C.spareNow(layout, inv);
const ports = R.enumPorts(layout, spare);
console.log('bane', res.stats.name, 'skinner', res.stats.piecesUsed, 'porte', ports.length, 'spare 24188', spare['24188'], '24172', spare['24172']);
let seed = 7; const rng = C.mulberry32(seed);
const box = { x0: o.margin, y0: o.margin, x1: o.W - o.margin, y1: o.H - o.margin };
const table = R.straightTable(spare), radii = C.RADII.filter(r => C.capacity(spare, r) >= 30);
const pairs = [];
while (pairs.length < N) { const A = ports[Math.floor(rng() * ports.length)], B = ports[Math.floor(rng() * ports.length)]; if (A !== B && R._apart(A, B, layout)) pairs.push([A, B]); }
let oldOk = 0, newOk = 0, both = 0, missed = [], extra = 0, tOld = 0, tNew = 0;
const depth = +(process.env.DEPTH || 7), maxStates = +(process.env.STATES || 60000);
for (const [A, B] of pairs) {
  let t = process.hrtime.bigint();
  let old = null;
  for (const c of R.solve(A.pose, B.pose, radii, table, 3000, box).slice(0, 40)) { const l = R._buildLink(A, B, c, spare, table); if (l) { old = l; break; } }
  tOld += Number(process.hrtime.bigint() - t) / 1e6;
  t = process.hrtime.bigint();
  const nw = R.connect(A, B, spare, { depth, maxStates, box });
  tNew += Number(process.hrtime.bigint() - t) / 1e6;
  if (old) oldOk++;
  if (nw.length) newOk++;
  if (old && nw.length) both++;
  if (old && !nw.length) missed.push([A.tag, B.tag, old.length.toFixed(0), old.pieces.length]);
  if (!old && nw.length) extra++;
}
console.log(`gammel ${oldOk}/${N}  ny ${newOk}/${N}  begge ${both}  kun ny ${extra}  mistet ${missed.length}`);
console.log('tid pr. par (ms): gammel', (tOld / N).toFixed(2), 'ny', (tNew / N).toFixed(1));
console.log('mistet:', JSON.stringify(missed.slice(0, 20)));
