// Enhedstest for lattice.js: node tools/test-lattice.js
const path = require('path');
const dir = path.join(__dirname, '..', 'static', 'js');
for (const f of ['core', 'graph', 'lattice']) require(path.join(dir, f + '.js'));
const MK = globalThis.MK, C = MK.core, L = MK.lattice;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FEJL:', msg); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
const U = mm => Math.round(mm * 10);

// 1. rot 12 gange = udgangspunktet; rot 6 = negation
{
  let p = [123, -45, 678, 9];
  let q = p; for (let i = 0; i < 12; i++) q = L.rot(q, 1);
  ok(L.eq(p, q), 'rot^12 = id');
  ok(L.eq(L.rot(p, 6), L.neg(p)), 'rot^6 = negation');
  for (let k = 0; k < 12; k++) {
    const a = L.toXY(L.rot([1883, 0, 0, 0], k)), h = k * 30 * Math.PI / 180;
    ok(near(a.x, 188.3 * Math.cos(h), 1e-9) && near(a.y, 188.3 * Math.sin(h), 1e-9), 'rot k=' + k + ' mod toXY');
  }
}
// 2. hvert skridts forskydning mod walkGeo (0,06 mm), i alle 12 startretninger
{
  const S = L.stepsFor({}, {});
  let n = 0;
  for (const s of S.steps) {
    const geos = s.kind === 'L' ? [C.lineG(s.n * s.cls.u / 10)] : s.kind === 'A' ? Array.from({ length: s.m }, () => C.arcG(s.dir, 30, s.r)) : [C.arcG(s.dir), C.arcG(-s.dir)];
    for (let k = 0; k < 12; k++) {
      const w = C.walkAll({ x: 0, y: 0, h: k * 30 }, geos);
      const t = L.toXY(s.R[k]);
      ok(near(w.x, t.x, 0.06) && near(w.y, t.y, 0.06), `skridt ${s.kind}${s.n || ''}${s.name || ''}${s.m || ''}${s.dir || ''} k=${k}: walkGeo ${w.x.toFixed(3)},${w.y.toFixed(3)} gitter ${t.x.toFixed(3)},${t.y.toFixed(3)}`);
      ok(near(((w.h - k * 30 - s.turn * 30) % 360 + 360) % 360, 0, 1e-6) || near(((w.h - k * 30 - s.turn * 30) % 360 + 360) % 360, 360, 1e-6), 'drejning ' + s.kind);
      n++;
    }
  }
  console.log('skridt kontrolleret:', n);
}
// 3. 12 x R1 30° venstre ender i origo, eksakt (også højre og alle radier)
for (const [name, r] of [['R1', C.R1], ['R2', C.R2], ['R3', C.R3], ['R4', C.R4], ['R5', C.R5]]) {
  for (const left of [true, false]) {
    let p = [0, 0, 0, 0], k = 0;
    for (let i = 0; i < 12; i++) { p = L.add(p, L.rot(left ? L.arcLeft(U(r)) : L.arcRight(U(r)), k)); k += left ? 1 : -1; }
    ok(L.eq(p, [0, 0, 0, 0]) && L.mod12(k) === 0, `12 x ${name} ${left ? 'venstre' : 'højre'} i origo (fik ${p})`);
  }
}
// 4. 24188 + 24172 = 360 mm lige, eksakt
{
  const a = [U(188.3) + U(171.7), 0, 0, 0];
  ok(L.eq(a, [3600, 0, 0, 0]), '24188 + 24172 = 360 mm');
  ok(U(C.BY_ART['24188'].len) + U(C.BY_ART['24172'].len) === 3600, 'katalog: 24188 + 24172');
}
// 5. R2-hjørne på 90° (3 x R2 30° venstre) = 77,5 lige + 3 x R1 30° + 77,5 lige, eksakt
{
  const walk = steps => { let p = [0, 0, 0, 0], k = 0; for (const [d, t] of steps) { p = L.add(p, L.rot(d, k)); k += t; } return p; };
  const R2c = walk([[L.arcLeft(U(C.R2)), 1], [L.arcLeft(U(C.R2)), 1], [L.arcLeft(U(C.R2)), 1]]);
  const R1c = walk([[[775, 0, 0, 0], 0], [L.arcLeft(U(C.R1)), 1], [L.arcLeft(U(C.R1)), 1], [L.arcLeft(U(C.R1)), 1]]);
  const R1d = L.add(R1c, L.rot([775, 0, 0, 0], 3));       // + 77,5 lige efter 90° drejning
  ok(L.eq(R2c, R1d), `R2-hjørne = 77,5 + 3xR1 + 77,5 (${R2c} mod ${R1d})`);
}
// 6. fromPose
{
  const o = { x: 123.4, y: -50.2, h: 90 };
  const pose = { x: o.x - 7.5, y: o.y + 100.0, h: 90 + 60 };
  const f = L.fromPose(pose, o);
  ok(f && f.k === 2, 'fromPose retning');
  const t = L.toXY(f.p);
  ok(near(t.x, 100.0, 0.06) && near(t.y, 7.5, 0.06), `fromPose position ${t.x},${t.y}`);
  ok(L.fromPose({ x: 0, y: 0, h: 24.28 }) === null, 'fromPose uden for gitteret');
  ok(L.fromPose({ x: 0, y: 0, h: 30.03 }) !== null, 'fromPose inden for 0,05°');
}
// 7. søgning: bfs finder en cirkel (12 x R1) som antipodepunkter
{
  const sp = { '24130': 12, '24188': 4 };
  const S = L.stepsFor(sp, {});
  const r = L.bfs({ x: 0, y: 0, h: 0 }, S, { depth: 6, maxStates: 5000, caps: S.capsFor(sp) });
  ok(r.list.length > 100, 'bfs finder tilstande: ' + r.list.length);
  const six = r.list.find(s => s.k === 6 && s.nodes.some(n => n.pcs === 6));
  ok(six && Math.abs(six.y) > 700, '6 x R1 venstre ender i retning 180° (diameter 720)');
  const hit = r.states.get(L.hkey(...six.p, six.k));
  ok(hit === six, 'hkey-opslag');
}
console.log(fails ? fails + ' fejl' : 'alle test bestået');
process.exit(fails ? 1 : 0);
