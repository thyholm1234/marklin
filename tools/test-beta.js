// Test: C.betaDraw/gammaDraw har den rigtige middelværdi og varians.
const path = require('path');
require(path.join(__dirname, '..', 'static', 'js', 'core.js'));
const C = globalThis.MK.core;
const rng = C.mulberry32(3);
let bad = 0;
for (const [a, b] of [[2, 3], [1, 1], [0.5, 0.5], [5, 1.5], [1.2, 8], [20, 30]]) {
  const N = 40000; let s = 0, s2 = 0;
  for (let i = 0; i < N; i++) { const x = C.betaDraw(rng, a, b); if (!(x >= 0 && x <= 1)) bad++; s += x; s2 += x * x; }
  const m = s / N, v = s2 / N - m * m, em = a / (a + b), ev = a * b / ((a + b) ** 2 * (a + b + 1));
  const ok = Math.abs(m - em) < 0.01 && Math.abs(v - ev) < 0.005;
  console.log(`Beta(${a},${b}) middel ${m.toFixed(4)} (forventet ${em.toFixed(4)}), varians ${v.toFixed(4)} (${ev.toFixed(4)}) ${ok ? 'ok' : 'FEJL'}`);
  if (!ok) bad++;
}
for (const k of [0.3, 1, 4.5]) {
  const N = 40000; let s = 0;
  for (let i = 0; i < N; i++) s += C.gammaDraw(rng, k);
  const ok = Math.abs(s / N - k) < 0.03 * Math.max(1, k);
  console.log(`Gamma(${k}) middel ${(s / N).toFixed(3)} ${ok ? 'ok' : 'FEJL'}`);
  if (!ok) bad++;
}
console.log(bad ? 'FEJL' : 'OK');
process.exit(bad ? 1 : 0);
