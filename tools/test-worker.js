// Kører static/js/worker.js i Node med en lille kunstig Worker-global og tester beskedprotokollen:
// start → resultater med uid, replaces mappes til uid, avoid-beskeder, stop; kort tilstand bruger generate.
// node tools/test-worker.js
const path = require('path');
const dir = path.join(__dirname, '..', 'static', 'js');
const out = [];
globalThis.self = globalThis;
globalThis.location = { href: 'http://localhost/js/worker.js?v=test' };
globalThis.importScripts = (...files) => files.forEach(f => require(path.join(dir, f.split('?')[0])));
globalThis.postMessage = m => out.push(m);
require(path.join(dir, 'worker.js'));
const MK = globalThis.MK;
const inv = { '24188': 57, '24172': 37, '24077': 3, '24977': 2, '24130': 44, '24230': 12, '24330': 6, '24224': 3, '24611': 1, '24612': 2, '24671': 4, '24672': 4, '24630': 1, '24640': 1, '24649': 1 };
const topologies = { loop: true, dogbone: true, p2p: true, figure8: true, free: false };
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('  FEJL:', msg); } else console.log('  ok:', msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  console.log('lang tilstand: to "workere" (to opstarter i samme proces er ikke mulig; testen kører worker 0 og 1 efter hinanden)');
  for (const first of [0, 2]) {
    out.length = 0;
    const base = { W: 3000, H: 1500, margin: 50, maximize: true, stationTracks: 2, point: { x: 1500, y: 50 }, topologies, avoid: ['xxx'], seed: 99 + first * 7919 };
    self.onmessage({ data: { cmd: 'start', id: 7, inv, opts: base, first, runMs: 500 } });
    await sleep(3200);
    self.onmessage({ data: { cmd: 'avoid', sig: 'hej' } });
    await sleep(600);
    self.onmessage({ data: { cmd: 'stop' } });
    const n = out.length;
    await sleep(900);
    check(out.length <= n + 1, `first=${first}: stop standser beskederne (${n} beskeder, ${out.length - n} efter stop)`);
    const ok = out.filter(m => m.result && !m.result.error && !m.result.idle);
    check(ok.length >= 3, `first=${first}: mindst 3 baner (fik ${ok.length})`);
    check(out.every(m => m.id === 7), 'alle beskeder bærer job-id');
    check(ok.every(m => m.uid > 0), 'uid sat');
    const uids = ok.map(m => m.uid);
    check(new Set(uids).size === uids.length, 'uid unikke');
    const rep = ok.filter(m => m.replaces);
    check(rep.every(m => uids.includes(m.replaces) && m.replaces < m.uid), `replaces mapper til tidligere uid (${rep.length} erstatninger)`);
    check(!out.some(m => m.result && m.result.idle), 'idle-svar sendes ikke');
    // grundformerne på skift: efter få kald er flere forskellige typer på skærmen
    const seen = new Set(ok.map(m => m.result.stats.topo));
    check(seen.size >= 3, `first=${first}: mindst 3 forskellige grundformer (${[...seen].join(',')})`);
    for (const m of ok) { const an = MK.graph.analyze(m.result); if (an.problems.length) { fails++; console.log('  FEJL: grafproblem'); } }
  }
  console.log('kort tilstand');
  out.length = 0;
  self.onmessage({ data: { cmd: 'start', id: 8, inv, opts: { W: 2050, H: 1200, margin: 50, maximize: false, stationTracks: 1, topologies: { loop: true }, avoid: [], seed: 5, timeBudget: 900 }, first: 0, runMs: 900 } });
  await sleep(2300);
  self.onmessage({ data: { cmd: 'stop' } });
  const q = out.filter(m => m.id === 8 && m.result && !m.result.error);
  check(q.length >= 2 && q.every(m => m.replaces === 0 && !m.result.id), `kort tilstand: ${q.length} baner via generate, uden replaces`);
  console.log(fails ? `FEJL ${fails}` : 'OK');
  process.exit(fails ? 1 : 0);
})();
