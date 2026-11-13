// Måler den vedvarende søgning som workeren bruger den: én session pr. grundform, next(ms) på skift, til tiden er gået.
// node tools/bench-session.js <preset> <W> <H> <n(ubrugt)> <outprefix|-> [ms pr. next, standard 1500] [json opts] [samlet tid i s, standard 30]
// Skriver SUM-linje (som bench.js), bedste point efter 5/10/20/30 s, antal nicher og armtabellen.
const fs = require('fs'), path = require('path');
const dir = process.env.MKDIR || path.join(__dirname, '..', 'static', 'js');
for (const f of (process.env.MKFILES || 'core,graph,lattice,topologies,elements,router,generator,search').split(',')) require(path.join(dir, f + '.js'));
const PRESETS = {
  mine: { '24188': 57, '24172': 37, '24077': 3, '24977': 2, '24130': 44, '24230': 12, '24330': 6, '24224': 3, '24611': 1, '24612': 2, '24671': 4, '24672': 4, '24630': 1, '24640': 1, '24649': 1 },
  large: { '24130': 16, '24115': 4, '24230': 16, '24215': 4, '24224': 12, '24206': 4, '24330': 12, '24360': 2, '24236': 4, '24188': 30, '24172': 16, '24094': 6, '24077': 4, '24071': 2, '24064': 2, '24611': 6, '24612': 6, '24977': 4 },
  medium: { '24130': 12, '24230': 12, '24224': 4, '24188': 16, '24172': 6, '24094': 4, '24077': 2, '24071': 2, '24064': 2, '24611': 2, '24612': 2, '24977': 2 },
  small: { '24130': 12, '24188': 6, '24172': 2, '24071': 1 },
};
const [preset, W, H, , out, msArg, extra, totalArg] = process.argv.slice(2);
const inv = PRESETS[preset], MS = +(msArg || 1500), TOTAL = +(totalArg || 30) * 1000;
const opts = Object.assign({ W: +W, H: +H, margin: 50, maximize: true, allSwitches: false, stationTracks: 2, point: { x: W / 2, y: 50 }, timeBudget: MS,
  topologies: { loop: true, dogbone: true, p2p: true, figure8: true, free: false } }, extra && extra !== '-' ? JSON.parse(extra) : {});
for (const t of ['loop', 'dogbone', 'p2p', 'figure8', 'free']) if (opts.topologies[t] === undefined) opts.topologies[t] = false;
const topos = Object.keys(opts.topologies).filter(t => opts.topologies[t]);
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : 0; };
const sessions = topos.map((t, i) => MK.createSession({ ...inv }, { ...opts, topologies: Object.fromEntries(Object.keys(opts.topologies).map(x => [x, x === t])), seed: 12345 + i * 7919 }));
const rows = [], niches = new Set(), checkpoints = [5, 10, 20, 30].filter(s => s * 1000 <= TOTAL + 1);
const bestAt = {};
let fejl = 0, best = -Infinity, calls = 0, errs = 0;
const t0 = Date.now();
const results = [];
for (let k = 0; Date.now() - t0 < TOTAL; k++) {
  const i = k % sessions.length, t1 = Date.now();
  const res = sessions[i].next(Math.min(MS, TOTAL - (t1 - t0) + 50));
  calls++;
  const el = Date.now() - t1;
  if (res.error || res.idle) { if (res.error) { console.log(k, 'ERR', res.error); fejl++; errs++; } rows.push({ ms: el }); }
  else {
    for (const a in res.used) if (res.used[a] > (inv[a] || 0)) { console.log('!! OVERFORBRUG', a); fejl++; }
    const an = MK.graph.analyze(res); if (an.problems.length) { console.log('!! GRAF', JSON.stringify(an.problems.slice(0, 3))); fejl++; }
    niches.add(topos[i] + '/' + res.niche);
    rows.push({ p: res.score, s: res.stats.piecesUsed, t: res.stats.tried, ms: el });
    results.push(res);
    best = Math.max(best, res.score);
    sessions.forEach((s, j) => { if (j !== i) s.addAvoid(res.sig); });
  }
  const sec = (Date.now() - t0) / 1000;
  for (const c of checkpoints) if (sec >= c && bestAt[c] === undefined) bestAt[c] = Math.round(best);
}
for (const c of checkpoints) if (bestAt[c] === undefined) bestAt[c] = Math.round(best);
const R = rows.filter(r => r.p !== undefined);
console.log(`SUM n=${R.length} fejl=${fejl} point(median/bedst)=${Math.round(med(R.map(r => r.p)))}/${Math.round(Math.max(-Infinity, ...R.map(r => r.p)))} skinner(median)=${med(R.map(r => r.s))} tried(median)=${med(R.map(r => r.t))} ms(median/maks)=${med(rows.map(r => r.ms))}/${Math.max(0, ...rows.map(r => r.ms))}`);
console.log('BEDSTE ' + checkpoints.map(c => `efter ${c}s: ${bestAt[c]}`).join('  ') + `  | nicher=${niches.size} next-kald=${calls}`);
// armtabel samlet over sessionerne
const agg = new Map();
for (const s of sessions) for (const a of s.stats().arms) {
  const g = agg.get(a.id) || { id: a.id, group: a.group, n: 0, chosen: 0, sum: 0, ms: 0 };
  g.n += a.n; g.chosen += a.chosen; g.sum += a.mean * a.n; g.ms += a.msMean * a.n; agg.set(a.id, g);
}
const gtot = {}; for (const a of agg.values()) gtot[a.group] = (gtot[a.group] || 0) + a.chosen;
console.log('ARME id n gevinst ms andel_af_valg');
for (const a of [...agg.values()].filter(a => a.n >= 5).sort((x, y) => (x.group < y.group ? -1 : 1))) console.log(`ARM ${a.id} n=${a.n} gevinst=${(a.sum / a.n).toFixed(3)} ms=${(a.ms / a.n).toFixed(0)} andel=${((a.chosen / (gtot[a.group] || 1)) * 100).toFixed(0)}%`);
if (out && out !== '-') {
  results.sort((a, b) => b.score - a.score);
  fs.writeFileSync(out + '.json', JSON.stringify(results.slice(0, 6).map(r => ({ score: r.score, niche: r.niche, sig: r.sig }))));
}
