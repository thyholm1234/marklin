// Testværktøj: node h.js <preset> <W> <H> <n> <outprefix> [ms] [json opts]
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const dir = process.env.MKDIR || path.join(__dirname, '..', 'static', 'js');
for (const f of (process.env.MKFILES || "core,graph,lattice,topologies,elements,router,generator,search").split(',')) require(path.join(dir, f + '.js'));
const PRESETS = {
  mine: { '24188': 57, '24172': 37, '24077': 3, '24977': 2, '24130': 44, '24230': 12, '24330': 6, '24224': 3, '24611': 1, '24612': 2, '24671': 4, '24672': 4, '24630': 1, '24640': 1, '24649': 1 },
  large: { '24130': 16, '24115': 4, '24230': 16, '24215': 4, '24224': 12, '24206': 4, '24330': 12, '24360': 2, '24236': 4, '24188': 30, '24172': 16, '24094': 6, '24077': 4, '24071': 2, '24064': 2, '24611': 6, '24612': 6, '24977': 4 },
  medium: { '24130': 12, '24230': 12, '24224': 4, '24188': 16, '24172': 6, '24094': 4, '24077': 2, '24071': 2, '24064': 2, '24611': 2, '24612': 2, '24977': 2 },
  small: { '24130': 12, '24188': 6, '24172': 2, '24071': 1 },
};
const [preset, W, H, n, out, ms, extra] = process.argv.slice(2);
const inv = PRESETS[preset];
const COLK = { straight: '#555', curve: '#27c', switch: '#c33', switch3: '#c33', cswitch: '#e80', sswitch: '#c33', dslip: '#939', crossing: '#939', buffer: '#000' };
function svg(res, W, H) {
  const P = pts => pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(0) + ' ' + (H - p.y).toFixed(0)).join('');
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 4}" height="${H / 4}"><rect width="${W}" height="${H}" fill="#eee"/>`;
  const draw = (p, dash) => {
    const col = COLK[MK.core.BY_ART[p.art].kind];
    for (const pts of [p.pts, ...(p.branchPtsList || [])]) s += `<path d="${P(pts)}" fill="none" stroke="${col}" stroke-width="22" ${dash ? 'stroke-opacity=".6"' : ''}/>`;
    const a = p.pts[0]; s += `<circle cx="${a.x.toFixed(0)}" cy="${(H - a.y).toFixed(0)}" r="9" fill="#fff"/>`;
  };
  for (const sd of res.sides) for (const p of sd.pieces) if (!p.virtual) draw(p, true);
  for (const ch of res.chains) for (const p of ch.pieces) if (!p.virtual) draw(p);
  s += `<text x="20" y="60" font-size="50">${Math.round(res.score)} ${res.stats.name} ${res.stats.piecesUsed}/${res.stats.piecesTotal}</text></svg>`;
  return s;
}
const opts = Object.assign({ W: +W, H: +H, margin: 50, maximize: true, allSwitches: false, stationTracks: 2, point: { x: W / 2, y: 50 }, timeBudget: +(ms || 2500),
  topologies: { loop: true, dogbone: true, p2p: true, figure8: true, free: false } }, extra ? JSON.parse(extra) : {});
for (const t of ['loop', 'dogbone', 'p2p', 'figure8', 'free']) if (opts.topologies[t] === undefined) opts.topologies[t] = false;
const topos = Object.keys(opts.topologies).filter(t => opts.topologies[t]);
const results = [];
const sumRows = [];
let fejl = 0;
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : 0; };
for (let k = 0; k < +n; k++) {
  const tp = Object.fromEntries(Object.keys(opts.topologies).map(t => [t, t === topos[k % topos.length]]));
  const t0 = Date.now();
  const res = MK.generate({ ...inv }, { ...opts, topologies: tp, seed: 12345 + k * 104729 });
  if (res.error) { console.log(k, 'ERR', res.error); fejl++; continue; }
  // lagerkontrol
  for (const a in res.used) if (res.used[a] > (inv[a] || 0)) { console.log('!! OVERFORBRUG', a, res.used[a], inv[a] || 0); fejl++; }
  const an = MK.graph.analyze(res); if (an.problems.length) { console.log('!! GRAF', JSON.stringify(an.problems.slice(0, 4))); fejl++; }
  res._an = an;
  console.log(k, `rev=${an.reverse} routes=${an.routes} comps=${an.components} dead=${an.deadEnds} trap=${an.trap} cov=${an.covered.toFixed(2)}`, Math.round(res.score), res.stats.name, `${res.stats.piecesUsed}/${res.stats.piecesTotal}`, res.strategies.map(x => x.id + (x.n > 1 ? 'x' + x.n : '')).join(','), JSON.stringify(Object.fromEntries(Object.entries(res.scoreParts).map(([k, v]) => [k, Math.round(v)]))), JSON.stringify(res.stats.timing), `tried=${res.stats.tried} invalid=${res.stats.invalid} valid=${res.stats.valid} sig=${res.sig}`, (Date.now() - t0) + "ms");
  results.push(res);
  sumRows.push({ p: res.score, s: res.stats.piecesUsed, t: res.stats.tried, ms: Date.now() - t0 });
}
console.log(`SUM n=${n} fejl=${fejl} point(median/bedst)=${Math.round(med(sumRows.map(r => r.p)))}/${Math.round(Math.max(-Infinity, ...sumRows.map(r => r.p)))} skinner(median)=${med(sumRows.map(r => r.s))} tried(median)=${med(sumRows.map(r => r.t))} ms(median/maks)=${med(sumRows.map(r => r.ms))}/${Math.max(0, ...sumRows.map(r => r.ms))}`);
results.sort((a, b) => b.score - a.score);
if (out && out !== '-') results.slice(0, 6).forEach((res, i) => { fs.writeFileSync(`${out}${i}.svg`, svg(res, +W, +H)); execSync(`rsvg-convert ${out}${i}.svg -o ${out}${i}.png`); });
