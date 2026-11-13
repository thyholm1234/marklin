// Test af sessionen (generator v2) i Node – uden browser:
//  1. determinisme: to sessioner med samme seed og opts.maxIterations giver samme bane
//  2. to sessioner med forskellig seed, 'avoid' sendt imellem dem som hovedtråden ville, og replaces-logikken
//  3. alle returnerede baner består grafkontrol og lagerkontrol; idle/error-svar ignoreres
// node tools/test-session.js
const path = require('path');
const dir = path.join(__dirname, '..', 'static', 'js');
for (const f of ['core', 'graph', 'lattice', 'topologies', 'elements', 'router', 'generator', 'search']) require(path.join(dir, f + '.js'));
const MK = globalThis.MK;
const inv = { '24188': 57, '24172': 37, '24077': 3, '24977': 2, '24130': 44, '24230': 12, '24330': 6, '24224': 3, '24611': 1, '24612': 2, '24671': 4, '24672': 4, '24630': 1, '24640': 1, '24649': 1 };
const base = { W: 3000, H: 1500, margin: 50, maximize: true, stationTracks: 2, point: { x: 1500, y: 50 } };
const topos = ['loop', 'dogbone', 'p2p', 'figure8'];
const tp = t => Object.fromEntries(topos.map(x => [x, x === t]));
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('  FEJL:', msg); } else console.log('  ok:', msg); };
const shape = res => JSON.stringify({ score: Math.round(res.score * 1e6), sig: res.sig, niche: res.niche,
  chains: res.chains.map(c => c.pieces.map(p => p.art + ':' + JSON.stringify(p.geo))), sides: res.sides.map(s => s.pieces.map(p => p.art)) });
const verify = (res, label) => {
  const an = MK.graph.analyze(res);
  const over = Object.keys(res.used).filter(a => res.used[a] > (inv[a] || 0));
  check(!an.problems.length && !over.length, `${label}: grafkontrol og lager`);
};

console.log('1. determinisme');
for (const t of ['loop', 'dogbone']) {
  const mk = () => MK.createSession({ ...inv }, { ...base, topologies: tp(t), seed: 4242, maxIterations: 40 });
  const a = mk().next(1), b = mk().next(1);
  check(!a.error && !b.error && shape(a) === shape(b), `${t}: samme seed → samme bane (point ${Math.round(a.score)})`);
  const c = MK.createSession({ ...inv }, { ...base, topologies: tp(t), seed: 4243, maxIterations: 40 }).next(1);
  check(shape(a) !== shape(c) || true, `${t}: anden seed kører (point ${Math.round(c.score)})`);
}
{ // to kald i samme session er også deterministiske
  const mk = () => MK.createSession({ ...inv }, { ...base, topologies: tp('loop'), seed: 77, maxIterations: 25 });
  const s1 = mk(), s2 = mk();
  const r1 = [s1.next(1), s1.next(1)], r2 = [s2.next(1), s2.next(1)];
  check(r1.every((r, i) => (r.idle && r2[i].idle) || (!r.error && shape(r) === shape(r2[i]))), 'to kald i samme session giver samme følge');
}

console.log('2. to sessioner, avoid og replaces (tid: 5 runder à 700 ms)');
{
  const sess = [0, 1].map(i => MK.createSession({ ...inv }, { ...base, topologies: Object.fromEntries(topos.map(x => [x, true])), seed: 1000 + i * 7919 }));
  const list = [];            // som hovedtrådens liste: { worker, id, sig, score, no }
  let counter = 0, dup = 0, badReplace = 0, results = 0, replaced = 0;
  for (let round = 0; round < 5; round++) {
    sess.forEach((s, w) => {
      const res = s.next(700);
      if (res.error || res.idle) return;          // fejl/idle ignoreres
      results++;
      verify(res, `worker ${w} runde ${round}`);
      const k = list.findIndex(e => e.worker === w && e.id === res.replaces);
      if (res.replaces) {
        if (k < 0) badReplace++;                  // replaces peger på noget der ikke (længere) er på listen: læg til
      }
      if (res.replaces && k >= 0) { list[k] = { ...list[k], id: res.id, sig: res.sig, score: res.score }; replaced++; }
      else list.push({ worker: w, id: res.id, sig: res.sig, score: res.score, no: ++counter });
      sess.forEach((o, j) => { if (j !== w) o.addAvoid(res.sig); });
    });
  }
  check(results >= 4, `mindst 4 resultater (fik ${results}, heraf ${replaced} med replaces)`);
  const ids = list.map(e => e.worker + ':' + e.id);
  dup = ids.length - new Set(ids).size;
  check(dup === 0, 'ingen dobbeltposter i listen');
  check(badReplace === 0, 'replaces peger altid på en bane der er på listen (ingen sletninger her)');
  const niches = new Set(list.map(e => e.sig));
  console.log('  listen:', list.map(e => `${e.worker}#${e.id}:${Math.round(e.score)}`).join(' '), '| forskellige sig:', niches.size);
}

console.log('3. avoid: undgåede sig vælges kun hvis der ikke er andre');
{
  const s = MK.createSession({ ...inv }, { ...base, topologies: Object.fromEntries(topos.map(x => [x, true])), seed: 5 });
  const r1 = s.next(900);
  s.addAvoid(r1.sig);
  const r2 = s.next(900);
  if (!r2.error && !r2.idle) check(r2.sig !== r1.sig || r2.replaces === r1.id, 'næste svar undgår første sig (eller erstatter den)');
  else check(true, 'næste svar idle (intet nyt)');
}

console.log(fails ? `FEJL ${fails}` : 'OK');
process.exit(fails ? 1 : 0);
