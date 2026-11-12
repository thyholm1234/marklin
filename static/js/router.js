/*
 * Ruteløser: den generelle sammensætter. I stedet for faste skabeloner finder den selv ud af,
 * hvordan to sporskifter et vilkårligt sted på banen kan forbindes.
 *
 *  1. Porte: alle steder hvor et sporskifte fra lageret kan sættes ind (alm. sporskifte i et 24188,
 *     buesporskifte i en 24130/24330 – både med hovedsporet gennem det indre og det ydre ben).
 *     Hver port har en præcis position og retning hvor næste skinne skal sættes på.
 *  2. Forbindelse: mellem to porte søges en rute  bue · lige · bue · lige · bue.  Buernes vinkler og
 *     radier gennemprøves; de to lige længder er så givet af et 2×2 ligningssystem og skal kunne
 *     lægges præcist (± 0,7 mm) med lige stykker fra lageret.
 *  3. Frihøjde: ruten må ikke komme nærmere end 74 mm på andre spor – undtagen hvor den løber ud
 *     af sit eget sporskifte, hvor afstanden skal vokse som i Märklins egen geometri.
 *  4. Vurdering: de gyldige ruter vurderes med sporgrafen (giver ruten en vendemulighed, hvor lang
 *     er den), og den bedste lægges ind som en ny kæde, der selv kan få sporskifter og stationer.
 */
(function (root) {
  'use strict';
  const MK = root.MK;
  const C = MK.core;
  const { D2R, STRAIGHTS, RADII, R1, R2, SW_ANG, TRACK_SPACING, lenOf, arcG, lineG, linePiece, arcPieces, handFor, norm180,
    walkGeo, layoutChain, takeArc, hasArts, capacity, spareNow, shuffle, newRunId, Grid, buildSide } = C;

  const CLEAR = 74;            // mindste afstand mellem to spor (77,5 mm parallelspor er i orden)
  const LEN_TOL = 0.7;         // tolerance pr. lige strækning
  const GAP_TOL = 1.6;         // største spalte hvor ruten møder målsporskiftet

  // ---------- lige stykker: alle længder lageret kan lægge ----------
  const tableCache = new Map();
  const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  function straightTable(spare) {
    const types = STRAIGHTS.filter(p => (spare[p.art] || 0) > 0).sort((a, b) => b.len - a.len);
    let maxP = 16;
    while (maxP > 4 && binom(maxP + types.length, types.length) > 30000) maxP--;
    const key = types.map(p => p.art + ':' + Math.min(spare[p.art], maxP)).join(',');
    let t = tableCache.get(key);
    if (t) return t;
    const list = [], cur = new Array(types.length).fill(0);
    (function rec(ti, sum, n) {
      if (ti === types.length) { list.push({ sum, n, c: cur.slice() }); return; }
      const lim = Math.min(spare[types[ti].art], maxP - n);
      for (let k = 0; k <= lim; k++) { cur[ti] = k; rec(ti + 1, sum + k * types[ti].len, n + k); }
      cur[ti] = 0;
    })(0, 0, 0);
    list.sort((a, b) => a.sum - b.sum);
    const sums = Float64Array.from(list, x => x.sum);
    const lower = v => { let lo = 0, hi = sums.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sums[m] < v) lo = m + 1; else hi = m; } return lo; };
    t = {
      has(L, tol) { const i = lower(L - tol); return i < sums.length && sums[i] <= L + tol; },
      /** Færrest stykker med længde L ± tol som lageret sp kan levere (ellers null). */
      find(L, tol, sp) {
        let best = null;
        for (let i = lower(L - tol); i < sums.length && sums[i] <= L + tol; i++) {
          const x = list[i];
          if (best && x.n >= best.n) continue;
          if (x.c.every((k, ti) => k <= (sp[types[ti].art] || 0))) best = x;
        }
        if (!best) return null;
        const arts = [];
        best.c.forEach((k, ti) => { for (let j = 0; j < k; j++) arts.push(types[ti].art); });
        return arts;
      },
    };
    if (tableCache.size > 12) tableCache.clear();
    tableCache.set(key, t);
    return t;
  }

  // ---------- porte ----------
  const CSW = {
    '24130': { L: '24671', R: '24672', r: R1, off: 77.5 },
    '24330': { L: '24771', R: '24772', r: C.R3, off: 64.3 },
  };
  const cswArt = (base, dir) => dir > 0 ? CSW[base].L : CSW[base].R;
  const outerLeg = (dir, base) => [lineG(CSW[base].off), arcG(dir, 30, CSW[base].r)];
  const revSegs = segs => segs.slice().reverse().map(sg => ({ ...sg, geo: sg.geo.kind === 'arc' ? { ...sg.geo, dir: -sg.geo.dir } : sg.geo }));

  /**
   * Alle porte på banens kæder. En port ved hvordan den sættes ind (apply) og fjernes igen (undo),
   * hvad den bruger fra lageret (need) og frigiver (free), og hvor næste skinne skal sidde (pose).
   */
  function enumPorts(layout, spare) {
    const ports = [];
    layout.chains.forEach((ch, ci) => {
      if (!ch.eligible) return;
      const P = ch.pieces, n = P.length;
      const at = i => ch.cyclic ? P[(i % n + n) % n] : P[i];
      const plain = q => q && !q.virtual && !q.branch && !q.xing;
      P.forEach((p, i) => {
        if (!plain(p)) return;
        const prev = at(i - 1), next = at(i + 1);
        if ((prev && prev.branch) || (next && next.branch)) return;
        for (const from of ['start', 'end']) {
          const tongue = from === 'start' ? p.start : { x: p.end.x, y: p.end.y, h: p.end.h + 180 };
          const sT = from === 'start' ? p.s0 : p.s1;
          const setBranch = (art, branch) => {
            let old = null;
            return { ok() { const k = P.indexOf(p); return k >= 0 && plain(p) && ![at(k - 1), at(k + 1)].some(q => q && q.branch); }, apply() { old = { art: p.art, branch: p.branch }; p.art = art; p.branch = branch; }, undo() { p.art = old.art; if (old.branch) p.branch = old.branch; else delete p.branch; } };
          };
          if (p.art === '24188' && p.run !== undefined && p.geo.kind === 'line') {
            for (const dir of [1, -1]) {
              const art = handFor(dir);
              if ((spare[art] || 0) < 1) continue;
              const leg = { art, geo: arcG(dir), virtual: true };
              const mk = (lead, tag) => ports.push({
                ci, lo: i, hi: i, p, tongue, sT, legLen: 190, tag, segs: [leg, ...lead], need: [art, ...lead.map(x => x.art)], free: ['24188'],
                ...setBranch(art, { dir, from }),
              });
              mk([], 'raw');
              if ((spare['24224'] || 0) > 0) mk([{ art: '24224', geo: arcG(-dir) }], 'par');
              if ((spare['24206'] || 0) > 0) mk([{ art: '24206', geo: arcG(dir, 30 - SW_ANG, R2) }], 'r30');
            }
          } else if (CSW[p.art] && p.geo.kind === 'arc') {
            // buesporskifte, hovedsporet gennem det indre ben: grenen går ud på ydersiden
            const dir = from === 'start' ? p.geo.dir : -p.geo.dir;
            const art = cswArt(p.art, dir);
            if ((spare[art] || 0) >= 1) {
              const geos = outerLeg(dir, p.art);
              ports.push({
                ci, lo: i, hi: i, p, tongue, sT, legLen: 270, tag: 'cs', segs: geos.map(g => ({ art, geo: g, virtual: true })), need: [art], free: [p.art],
                ...setBranch(art, { dir, from, geos }),
              });
            }
          }
        }
        // buesporskifte, hovedsporet gennem det ydre ben (77,5 mm lige + R1 30°): grenen går ind på
        // indersiden. Kræver et 24077 lige før/efter en 24130 – de to erstattes af sporskiftet.
        if (p.art === '24130' && p.geo.kind === 'arc') {
          for (const side of [-1, 1]) {
            const q = side < 0 ? prev : next, beyond = at(i + 2 * side);
            if (!plain(q) || q.art !== '24077' || q.geo.kind !== 'line' || (beyond && beyond.branch)) continue;
            const d = p.geo.dir;
            const from = side < 0 ? 'start' : 'end', dir = side < 0 ? d : -d;
            const art = cswArt('24130', dir);
            if ((spare[art] || 0) < 1) continue;
            const tongue = side < 0 ? q.start : { x: q.end.x, y: q.end.y, h: q.end.h + 180 };
            const inner = arcG(dir, 30, R1);
            const piece = { art, geo: { kind: 'path', geos: side < 0 ? [lineG(77.5), arcG(d, 30, R1)] : [arcG(d, 30, R1), lineG(77.5)] }, branch: { dir, from, geos: [inner] } };
            const pair = side < 0 ? [q, p] : [p, q];
            ports.push({
              ci, lo: Math.min(i, i + side), hi: Math.max(i, i + side), p, tongue, sT: side < 0 ? q.s0 : q.s1, legLen: 270, tag: 'ci',
              segs: [{ art, geo: inner, virtual: true }], need: [art], free: ['24130', '24077'],
              ok() { const k = P.indexOf(pair[0]); return k >= 0 && P[k + 1] === pair[1] && plain(pair[0]) && plain(pair[1]) && ![at(k - 1), at(k + 2)].some(x => x && x.branch); },
              apply() { const k = ch.pieces.indexOf(pair[0]); ch.pieces.splice(k, 2, piece); layoutChain(ch); },
              undo() { const k = ch.pieces.indexOf(piece); ch.pieces.splice(k, 1, ...pair); layoutChain(ch); },
            });
          }
        }
      });
    });
    for (const pt of ports) { let st = pt.tongue; for (const sg of pt.segs) st = walkGeo(st, sg.geo).end; pt.pose = st; }
    return ports;
  }

  // ---------- forbindelse mellem to stillinger ----------
  const ALPHAS = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180, -180];
  const A_IDX = Object.fromEntries(ALPHAS.map((a, i) => [a, i]));
  // pr. vinkel: cos/sin og buens forskydning for radius 1 i lokalt system (start i retning 0)
  const A_COS = ALPHAS.map(a => Math.cos(a * D2R)), A_SIN = ALPHAS.map(a => Math.sin(a * D2R));
  const A_LX = ALPHAS.map(a => Math.sin(Math.abs(a) * D2R)), A_LY = ALPHAS.map(a => Math.sign(a) * (1 - Math.cos(a * D2R)));
  /**
   * Ruter fra stilling a til stilling b (b.h peger ud af målporten, ruten ankommer modsat).
   * Returnerer kandidater {al:[α1,α2,α3], r, L1, L2}.
   */
  function solve(a, b, radii, table, maxLen, box) {
    const hT = b.h + 180;
    const delta = norm180(hT - a.h), d30 = Math.round(delta / 30) * 30;
    if (Math.abs(delta - d30) > 0.05) return [];
    const out = [];
    const dx = b.x - a.x, dy = b.y - a.y;
    const c0 = Math.cos(a.h * D2R), s0 = Math.sin(a.h * D2R);
    for (let i1 = 0; i1 < ALPHAS.length; i1++) {
      const a1 = ALPHAS[i1];
      const c1 = c0 * A_COS[i1] - s0 * A_SIN[i1], s1 = s0 * A_COS[i1] + c0 * A_SIN[i1];      // retning efter bue 1
      const e1x = A_LX[i1] * c0 - A_LY[i1] * s0, e1y = A_LX[i1] * s0 + A_LY[i1] * c0;
      for (let i2 = 0; i2 < ALPHAS.length; i2++) {
        const a2 = ALPHAS[i2];
        const c2 = c1 * A_COS[i2] - s1 * A_SIN[i2], s2 = s1 * A_COS[i2] + c1 * A_SIN[i2];    // retning efter bue 2
        const g2x = A_LX[i2] * c1 - A_LY[i2] * s1, g2y = A_LX[i2] * s1 + A_LY[i2] * c1;
        const e2x = e1x + g2x, e2y = e1y + g2y;
        const det = A_SIN[i2];                                                               // u1 × u2
        const a3n = norm180(d30 - a1 - a2);
        const a3s = Math.abs(Math.abs(a3n) - 180) < 1e-9 ? [180, -180] : [Math.round(a3n / 30) * 30];
        for (const a3 of a3s) {
          if (Math.abs(a1) + Math.abs(a2) + Math.abs(a3) > 390) continue;
          const i3 = A_IDX[a3];
          const ex = e2x + A_LX[i3] * c2 - A_LY[i3] * s2, ey = e2y + A_LX[i3] * s2 + A_LY[i3] * c2;
          for (const r of radii) {
            const Dx = dx - r * ex, Dy = dy - r * ey;
            let L1, L2;
            if (Math.abs(det) < 1e-6) {
              // de to lige stræk er parallelle: tværafvigelsen skal gå op af sig selv
              if (Math.abs(Dx * s1 - Dy * c1) > LEN_TOL) continue;
              const along = Dx * c1 + Dy * s1;
              if (a2 === 0) { L1 = along; L2 = 0; }
              else { L2 = along >= 0 ? 0 : -along; L1 = along >= 0 ? along : 0; }             // modsatrettede: L1 − L2 = along
            } else {
              L1 = (Dx * s2 - Dy * c2) / det;
              L2 = (c1 * Dy - s1 * Dx) / det;
            }
            if (L1 < -LEN_TOL || L2 < -LEN_TOL || L1 > maxLen || L2 > maxLen) continue;
            if (L1 < LEN_TOL && a1 && a2 && Math.sign(a1) === Math.sign(a2)) continue;       // samme rute findes med én bue
            if (L2 < LEN_TOL && a2 && a3 && Math.sign(a2) === Math.sign(a3)) continue;
            if (box) {
              // rutens knækpunkter skal ligge på pladen (billig forkontrol før ruten bygges)
              const p1x = a.x + r * e1x, p1y = a.y + r * e1y, p2x = p1x + L1 * c1, p2y = p1y + L1 * s1;
              const p3x = p2x + r * g2x, p3y = p2y + r * g2y, p4x = p3x + L2 * c2, p4y = p3y + L2 * s2;
              if (Math.min(p1x, p2x, p3x, p4x) < box.x0 || Math.max(p1x, p2x, p3x, p4x) > box.x1 || Math.min(p1y, p2y, p3y, p4y) < box.y0 || Math.max(p1y, p2y, p3y, p4y) > box.y1) continue;
            }
            if (!table.has(Math.max(0, L1), LEN_TOL) || !table.has(Math.max(0, L2), LEN_TOL)) continue;
            out.push({ al: [a1, a2, a3], r, L1: Math.max(0, L1), L2: Math.max(0, L2) });
          }
        }
      }
    }
    return out;
  }

  /** Byg rutens skinner (inkl. portenes ben) – null hvis lageret ikke rækker eller spalten er for stor. */
  function buildLink(A, B, cand, spare, table) {
    const sp = { ...spare };
    [...A.free, ...B.free].forEach(a => { sp[a] = (sp[a] || 0) + 1; });
    if (!hasArts(sp, [...A.need, ...B.need])) return null;
    [...A.need, ...B.need].forEach(a => sp[a]--);
    const mid = [];
    const arc = al => {
      if (!al) return true;
      const arts = takeArc(sp, cand.r, Math.abs(al)); if (!arts) return false;
      mid.push(...arcPieces(arts, Math.sign(al)));
      return true;
    };
    const line = L => {
      if (L < LEN_TOL) return true;
      const arts = table.find(L, LEN_TOL, sp); if (!arts) return false;
      const id = newRunId();
      shuffleRun(arts).forEach(a => { sp[a]--; mid.push({ ...linePiece(a), run: id }); });
      return true;
    };
    if (!arc(cand.al[0]) || !line(cand.L1) || !arc(cand.al[1]) || !line(cand.L2) || !arc(cand.al[2])) return null;
    if (!mid.length) return null;
    const pieces = [...A.segs.map(s => ({ ...s })), ...mid, ...revSegs(B.segs)];
    const ch = { kind: 'link', cyclic: false, junc: true, eligible: true, pieces, start: A.tongue };
    layoutChain(ch);
    const e = ch.end, t = B.tongue;
    if (Math.hypot(e.x - t.x, e.y - t.y) > GAP_TOL || Math.abs(norm180(e.h - t.h - 180)) > 0.5) return null;
    return ch;
  }
  // 24188 yderst i strækningen, så der senere kan sættes sporskifter ind (de må ikke være naboer)
  const shuffleRun = arts => arts.slice().sort((x, y) => (x === '24188') - (y === '24188'));


  // ---------- forbindelse på gitteret: mødes på midten ----------
  // Fra hver port søges bredde-først over lige stykker, 30°-buer og S-kurver (lattice.js). Pr. port gøres det én
  // gang; alle søgninger lægges i ét fælles indeks (position + retning), så to porte mødes, når en tilstand fra
  // den ene og en tilstand fra den anden ligger samme sted med modsat retning. Portenes stillinger er decimaltal
  // (sporskiftets gren er 24,28°), så mødet findes med 0,5 mm tolerance; den færdige rute kontrolleres alligevel
  // i decimaltal (spalte højst GAP_TOL, vinkel højst 0,5°). To porte kan kun mødes, hvis deres retninger
  // ligger et helt antal 30° fra hinanden – det er "klassen" (vinkel mod 30°).
  const LT = MK.lattice;
  let SOBJ = null;
  const stepObj = () => SOBJ || (SOBJ = LT.stepsFor({}, {}));
  const MEET_TOL = 0.6;
  const cellKey = (cls, k, ix, iy) => ((cls * 12 + k) * 16384 + (ix + 8192)) * 16384 + (iy + 8192);

  /** Søg fra en port (lageret efter portens eget forbrug). Returnerer null hvis lageret ikke rækker. */
  function searchPort(port, spare, o) {
    const sp = { ...spare };
    port.free.forEach(a => { sp[a] = (sp[a] || 0) + 1; });
    port.need.forEach(a => { sp[a] = (sp[a] || 0) - 1; });
    if (Object.values(sp).some(v => v < 0)) return null;
    const S = stepObj(), hc = LT.headClass(port.pose.h);
    const r = LT.bfs(port.pose, S, { depth: o.depth, maxStates: o.maxStates, box: o.box, caps: S.capsFor(sp), rng: o.rng, maxTurn: o.maxTurn, perState: o.perState });
    return { port, cls: hc.cls, k0: hc.k, r };
  }

  /**
   * Indeks over søgninger fra flere porte. pairOk(A, B) afgør hvilke par der må forbindes.
   * Resultat: { searches, pairs:[{ i, j, meets:[{ na, nb, pcs }] }] } (højst `perPair` møder pr. par, færrest skinner først).
   */
  function makeIndex(ports, spare, o) {
    const searches = [], idx = new Map(), pairs = new Map();
    const perPair = o.perPair || 12;
    for (const port of ports) {
      if (o.deadline && searches.length >= 2 && Date.now() > o.deadline) break;       // tidsbudget: resten af portene springes over
      const sr = searchPort(port, spare, o);
      const si = searches.length;
      searches.push(sr);
      if (!sr) continue;
      const { cls, k0 } = sr, list = sr.r.list;
      // 1. find møder med tidligere søgninger
      for (const st of list) {
        const ka = (st.k + k0) % 12, kq = (ka + 6) % 12;
        const ix = Math.floor(st.x), iy = Math.floor(st.y);
        const jx = st.x - ix < 0.5 ? ix - 1 : ix + 1, jy = st.y - iy < 0.5 ? iy - 1 : iy + 1;
        for (let q = 0; q < 4; q++) {
          const lst = idx.get(cellKey(cls, kq, q & 1 ? jx : ix, q & 2 ? jy : iy));
          if (!lst) continue;
          for (const e of lst) {
            if (e.si === si) continue;
            if (Math.hypot(e.st.x - st.x, e.st.y - st.y) > MEET_TOL) continue;
            if (o.pairOk && !o.pairOk(searches[e.si].port, port)) continue;
            const pk = e.si * 100000 + si;
            let pr = pairs.get(pk);
            if (!pr) pairs.set(pk, pr = { i: e.si, j: si, meets: [] });
            for (const na of e.st.nodes) for (const nb of st.nodes) {
              if (pr.meets.length >= perPair * 4) { let wi = 0; for (let m = 1; m < pr.meets.length; m++) if (pr.meets[m].pcs > pr.meets[wi].pcs) wi = m; if (pr.meets[wi].pcs <= na.pcs + nb.pcs) continue; pr.meets.splice(wi, 1); }
              pr.meets.push({ na, nb, pcs: na.pcs + nb.pcs });
            }
          }
        }
      }
      // 2. læg egne tilstande i indekset
      for (const st of list) {
        const k = cellKey(cls, (st.k + k0) % 12, Math.floor(st.x), Math.floor(st.y));
        let l = idx.get(k); if (!l) idx.set(k, l = []);
        l.push({ si, st });
      }
    }
    return { searches, pairs: [...pairs.values()] };
  }

  /** Byg ruten for et møde (skridt fra A og fra B). Returnerer { pieces, length, gap, ch } eller null. */
  function linkFromSteps(A, B, stepsA, stepsB, spare) {
    const sp = { ...spare };
    [...A.free, ...B.free].forEach(a => { sp[a] = (sp[a] || 0) + 1; });
    if (!hasArts(sp, [...A.need, ...B.need])) return null;
    [...A.need, ...B.need].forEach(a => sp[a]--);
    const pa = LT.buildPieces(stepsA, sp); if (!pa) return null;
    const pb = LT.buildPieces(stepsB, sp); if (!pb) return null;
    const mid = LT.mergeRuns([...pa, ...revSegs(pb)]);
    if (!mid.length) return null;
    const pieces = [...A.segs.map(s => ({ ...s })), ...mid, ...revSegs(B.segs)];
    const ch = { kind: 'link', cyclic: false, junc: true, eligible: true, pieces, start: A.tongue };
    layoutChain(ch);
    const e = ch.end, t = B.tongue;
    const gap = Math.hypot(e.x - t.x, e.y - t.y);
    if (gap > GAP_TOL || Math.abs(norm180(e.h - t.h - 180)) > 0.5) return null;
    return { pieces, length: ch.length, gap, ch, stepsA, stepsB };
  }
  const meetLink = (A, B, m, spare) => {
    const S = stepObj();
    const r = linkFromSteps(A, B, LT.pathSteps(m.na, S), LT.pathSteps(m.nb, S), spare);
    return r;
  };

  /**
   * Alle ruter fra port A til port B (som kandidater { pieces, length, gap }), færrest skinner først.
   * opts: { depth (7), maxStates (60000), box, limit (8), rng, index } – med opts.index genbruges søgningerne
   * (se makeIndex): { index, ia, ib } = placeringen af A og B i indekset.
   */
  function connect(A, B, spare, opts = {}) {
    const o = { depth: 7, maxStates: 60000, perPair: 12, ...opts };
    const limit = o.limit || 8, out = [];
    const index = makeIndex([A, B], spare, o);
    const pr = index.pairs[0];
    if (pr) {
      pr.meets.sort((x, y) => x.pcs - y.pcs);
      for (const m of pr.meets) {
        const c = meetLink(A, B, m, spare);
        if (c) out.push(c);
        if (out.length >= limit) break;
      }
    }
    if (o.noOld) return out;
    // lange, enkle ruter (bue · lige · bue · lige · bue) ligger uden for søgningens dybde: den analytiske løser tager dem
    const old = oldConnect(A, B, spare, o.box, 4);
    for (const c of old) out.push(c);
    return out;
  }
  /** Den gamle løser: bue · lige · bue · lige · bue med præcise længder (±0,7 mm). */
  function oldConnect(A, B, spare, box, limit = 4) {
    const table = straightTable(spare), radii = RADII.filter(r => capacity(spare, r) >= 30);
    const cands = solve(A.pose, B.pose, radii.length ? radii : [R1], table, 4000, box);
    cands.sort((x, y) => (Math.abs(x.al[0]) + Math.abs(x.al[1]) + Math.abs(x.al[2])) - (Math.abs(y.al[0]) + Math.abs(y.al[1]) + Math.abs(y.al[2])));
    const out = [];
    for (const cand of cands.slice(0, 40)) {
      const ch = buildLink(A, B, cand, spare, table);
      if (!ch) continue;
      out.push({ pieces: ch.pieces, length: ch.length, gap: Math.hypot(ch.end.x - B.tongue.x, ch.end.y - B.tongue.y), ch });
      if (out.length >= limit) break;
    }
    return out;
  }

  // ---------- frihøjde ----------
  function obstacleGrid(layout) {
    const g = new Grid(MIN_CLEAR_CELL);
    layout.chains.forEach((ch, ci) => ch.samples.forEach(q => g.add({ x: q.x, y: q.y, ci, s: q.s })));
    layout.sides.forEach(sd => sd.pts.forEach(q => g.add({ x: q.x, y: q.y, ci: -1, s: 0 })));
    return g;
  }
  const MIN_CLEAR_CELL = 75;
  /** Krævet afstand til portens eget spor som funktion af rutens afstand fra tungen. */
  const reqNear = (dp, legLen) => dp <= legLen + 8 ? 0 : dp < 330 ? 38 : dp < 650 ? 38 + (dp - 330) * 36 / 320 : CLEAR;
  function clearPath(link, layout, o, grid, A, B) {
    const m = o.margin, S = link.samples, Lp = link.length;
    if (!C.pointsClearAreas(S, o.areas)) return false;
    for (const p of S) if (p.x < m || p.y < m || p.x > o.W - m || p.y > o.H - m) return false;
    const chainDist = (T, s) => {
      const ch = layout.chains[T.ci];
      let d = Math.abs(s - T.sT);
      if (ch.cyclic) d = Math.min(d, ch.length - d);
      return d;
    };
    for (const p of S) {
      if (grid.near(p.x, p.y, q => {
        const dx = q.x - p.x, dy = q.y - p.y, dd = dx * dx + dy * dy;
        if (dd >= CLEAR * CLEAR) return false;
        for (const [T, dp] of [[A, p.s], [B, Lp - p.s]]) {
          if (q.ci !== T.ci || chainDist(T, q.s) > 700) continue;
          const req = reqNear(dp, T.legLen);
          if (dd >= req * req) return false;
        }
        return true;
      })) return false;
    }
    // ruten må ikke komme for tæt på sig selv
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      if (S[j].s - S[i].s < 250) continue;
      const dx = S[i].x - S[j].x, dy = S[i].y - S[j].y;
      if (dx * dx + dy * dy < CLEAR * CLEAR) return false;
    }
    return true;
  }

  // ---------- søgning ----------
  const apart = (A, B, layout) => {
    if (A.p === B.p) return false;
    if (A.ci !== B.ci) return true;
    const n = layout.chains[A.ci].pieces.length, cyc = layout.chains[A.ci].cyclic;
    const gap = (x, y) => { let d = Math.abs(x - y); if (cyc) d = Math.min(d, n - d); return d; };
    return Math.min(gap(A.lo, B.lo), gap(A.lo, B.hi), gap(A.hi, B.lo), gap(A.hi, B.hi)) >= 2;
  };
  /**
   * Læg op til `want` nye forbindelser ind. opts.pairs = hvor mange portpar der prøves pr. forbindelse,
   * opts.pick = hvor mange gyldige ruter der sammenlignes før den bedste vælges.
   */
  function addLinks(layout, inv, o, rng, want = 1, opts = {}) {
    const maxPairs = opts.pairs || 2500, pick = opts.pick || Math.max(5, 3 * want);
    const maxLen = Math.max(o.W, o.H);
    const box = { x0: o.margin, y0: o.margin, x1: o.W - o.margin, y1: o.H - o.margin };
    const dbg = opts.stats || null;
    const tStart = Date.now();
    let count = 0;
    // ét gennemløb finder flere gyldige ruter; de bedste lægges ind én ad gangen, så længe de stadig passer
    for (let sweep = 0; sweep < 2 && count < want; sweep++) {
      const spare = spareNow(layout, inv);
      const ports = enumPorts(layout, spare);
      if (ports.length < 2) break;
      const table = straightTable(spare);
      const radii = RADII.filter(r => capacity(spare, r) >= 30);
      let grid = obstacleGrid(layout);
      const before = MK.graph.analyze(layout);
      const feasible = [];
      const inner = ports.filter(p => p.tag === 'ci' && p.ci !== opts.focus);
      const focusPorts = opts.focus !== undefined ? ports.filter(p => p.ci === opts.focus) : null;
      const otherPorts = focusPorts ? ports.filter(p => p.ci !== opts.focus) : null;
      const pairOk = (X, Y) => {
        if (focusPorts && (X.ci === opts.focus) === (Y.ci === opts.focus)) return false;
        return apart(X, Y, layout);
      };
      const tryPair = (A, B, cands) => {
        // foretræk enkle ruter (få skinner), men med variation
        for (const c of cands.slice(0, 5)) {
          const link = c.ch;
          if (!link || link.length < 600) continue;
          if (dbg) dbg.built = (dbg.built || 0) + 1;
          if (!clearPath(link, layout, o, grid, A, B)) continue;
          if (dbg) { dbg.clear = (dbg.clear || 0) + 1; const k = A.tag + '-' + B.tag; dbg[k] = (dbg[k] || 0) + 1; }
          feasible.push({ A, B, link, stepsA: c.stepsA, stepsB: c.stepsB, cand: c.cand });
          return true;
        }
        return false;
      };
      // 1. gittersøgning: én søgning pr. port, fælles indeks, møder mellem alle par
      const CFG = MK.router.cfg;
      const nSel = opts.ports || CFG.ports;
      const take = (arr, n) => shuffle(rng, arr.slice()).slice(0, n);
      let sel = ports;
      if (ports.length > nSel) {
        if (focusPorts) {
          // skiftevis fra den udpegede kæde og fra resten, så tidsbudgettet rammer begge sider
          const fa = take(focusPorts, nSel >> 1), oa = take([...inner, ...otherPorts.filter(p => p.tag !== 'ci')], nSel - (nSel >> 1));
          sel = []; for (let i = 0; i < Math.max(fa.length, oa.length); i++) { if (i < fa.length) sel.push(fa[i]); if (i < oa.length) sel.push(oa[i]); }
        }
        else { const ci = take(inner, nSel >> 1); sel = [...ci, ...take(ports.filter(p => !ci.includes(p)), nSel - ci.length)]; }
      }
      if (focusPorts && (!focusPorts.length || !otherPorts.length)) break;
      const tI = Date.now();
      const idx = makeIndex(sel, spare, { depth: opts.depth || CFG.depth, maxStates: opts.maxStates || CFG.maxStates, perState: CFG.perState, deadline: Date.now() + (opts.ms || CFG.ms), box, rng, pairOk, perPair: 12 });
      if (dbg) { dbg.ms = (dbg.ms || 0) + Date.now() - tI; dbg.ports = (dbg.ports || 0) + sel.length; dbg.meetPairs = (dbg.meetPairs || 0) + idx.pairs.length; }
      const prs = idx.pairs.map(pr => ({ pr, w: rng() - ((idx.searches[pr.i].port.tag === 'ci' || idx.searches[pr.j].port.tag === 'ci') ? 0.7 : 0) })).sort((x, y) => x.w - y.w);
      for (const { pr } of prs) {
        if (feasible.length >= pick) break;
        const A = idx.searches[pr.i].port, B = idx.searches[pr.j].port;
        pr.meets.forEach(m => { m.w = m.pcs + 10 * rng(); });
        pr.meets.sort((x, y) => x.w - y.w);
        const cands = [];
        for (const m of pr.meets.slice(0, 8)) { const c = meetLink(A, B, m, spare); if (c) cands.push(c); if (cands.length >= 5) break; }
        if (dbg) { dbg.pairs = (dbg.pairs || 0) + 1; dbg.cands = (dbg.cands || 0) + cands.length; }
        tryPair(A, B, cands);
      }
      // 2. den gamle løser (bue · lige · bue · lige · bue) på tilfældige par: tager de lange, enkle ruter
      const nPairs = feasible.length >= pick ? 0 : Math.min(opts.pairs || CFG.oldPairs, ports.length * (ports.length - 1));
      for (let t = 0; t < nPairs && feasible.length < pick; t++) {
        let A = inner.length && rng() < 0.6 ? inner[Math.floor(rng() * inner.length)] : ports[Math.floor(rng() * ports.length)];
        let B = inner.length > 1 && rng() < 0.3 ? inner[Math.floor(rng() * inner.length)] : ports[Math.floor(rng() * ports.length)];
        if (focusPorts) {
          A = focusPorts[Math.floor(rng() * focusPorts.length)];
          B = inner.length && rng() < 0.6 ? inner[Math.floor(rng() * inner.length)] : otherPorts[Math.floor(rng() * otherPorts.length)];
          if (B.ci === opts.focus) continue;
          if (rng() < 0.5) [A, B] = [B, A];
        }
        if (A === B || !apart(A, B, layout)) continue;
        const cands = solve(A.pose, B.pose, radii.length ? radii : [R1], table, maxLen, box);
        if (dbg) { dbg.oldPairs = (dbg.oldPairs || 0) + 1; dbg.oldCands = (dbg.oldCands || 0) + cands.length; }
        if (!cands.length) continue;
        cands.forEach(c => { c.w = Math.abs(c.al[0]) + Math.abs(c.al[1]) + Math.abs(c.al[2]) + 240 * rng(); });
        cands.sort((x, y) => x.w - y.w);
        const built = [];
        for (const cand of cands.slice(0, 4)) { const l = buildLink(A, B, cand, spare, table); if (l) built.push({ ch: l, cand }); }
        if (tryPair(A, B, built) && dbg) dbg.oldFound = (dbg.oldFound || 0) + 1;
      }
      // vurder hver gyldig rute på den færdige sporgraf: vendemulighed vægter højest, så længde
      for (const f of feasible) {
        const undo = commit(layout, f);
        const an = MK.graph.analyze(layout);
        const neg = Object.values(spareNow(layout, inv)).some(v => v < 0);
        undo();
        f.val = an.problems.length || neg ? -Infinity : 1000 * (an.reverse - before.reverse) - 30 * Math.max(0, an.trap - before.trap) + 0.2 * Math.min(f.link.length, 4000) + (f.A.tag === 'ci' ? 150 : 0) + (f.B.tag === 'ci' ? 150 : 0) + 60 * rng();
      }
      feasible.sort((x, y) => y.val - x.val);
      let placed = 0;
      for (const f of feasible) {
        if (count >= want || f.val === -Infinity) break;
        if (placed) {
          // banen er ændret siden ruten blev fundet: portene skal stadig være frie, og ruten fri af de nye spor
          if (!f.A.ok() || !f.B.ok() || !apart(f.A, f.B, layout) || !clearPath(f.link, layout, o, grid, f.A, f.B)) continue;
        }
        const undo = commit(layout, f);
        if (placed && (MK.graph.validate(layout).length || Object.values(spareNow(layout, inv)).some(v => v < 0))) { undo(); continue; }
        count++; placed++;
        grid = obstacleGrid(layout);
        // punktsymmetrisk bane: den samme rute drejet 180° om banens centrum går også præcist op
        if (layout.sym && count < want + 1) {
          const sp2 = spareNow(layout, inv);
          const ports2 = enumPorts(layout, sp2);
          const mir = T => ports2.find(q => q.tag === T.tag && Math.hypot(q.tongue.x - (2 * layout.sym.x - T.tongue.x), q.tongue.y - (2 * layout.sym.y - T.tongue.y)) < 1.5 && Math.abs(norm180(q.tongue.h - T.tongue.h - 180)) < 0.5);
          const mA = mir(f.A), mB = mir(f.B);
          if (mA && mB && apart(mA, mB, layout)) {
            const link2 = f.stepsA ? (linkFromSteps(mA, mB, f.stepsA, f.stepsB, sp2) || {}).ch : buildLink(mA, mB, f.cand, sp2, straightTable(sp2));
            if (link2 && clearPath(link2, layout, o, grid, mA, mB)) {
              const undo2 = commit(layout, { A: mA, B: mB, link: link2 });
              if (MK.graph.validate(layout).length || Object.values(spareNow(layout, inv)).some(v => v < 0)) undo2();
              else { count++; grid = obstacleGrid(layout); }
            }
          }
        }
      }
      if (!placed) break;
    }
    if (MK.router.cfg.trace) MK.router.cfg.trace(Date.now() - tStart, opts);
    return count;
  }
  function commit(layout, f) {
    const { A, B, link } = f;
    A.apply(); B.apply();
    layout.chains.push(link);
    const rec = { type: 'link', pieces: [], pts: [], link: [A.ci, B.ci] };
    layout.sides.push(rec);
    return () => {
      layout.sides.splice(layout.sides.indexOf(rec), 1);
      layout.chains.splice(layout.chains.indexOf(link), 1);
      B.undo(); A.undo();
    };
  }

  // ---------- hjørneforbindelse mellem to parallelle spor (R1 inderst, R2 yderst) ----------
  // Et R2-hjørne på 90° har samme endepunkter som 77,5 mm lige + 3 × R1 30° + 77,5 mm lige. Det er
  // præcis buesporskiftets ydre ben (77,5 mm + R1 30°). Derfor kan det ydre spors hjørne bygges af
  // 24077 + 2 × 24130 + et buesporskifte, hvis indre ben peger ind mod det indre spor – og det indre
  // spors buesporskifte (ydre ben) rammer det med én 24130 imellem. Ingen 24224 eller alm. sporskifter.
  function addCornerCross(layout, inv, o, rng, want = 1) {
    let count = 0;
    const cands = [];
    layout.chains.forEach((Y, yi) => {
      if (!Y.cyclic) return;
      const P = Y.pieces, n = P.length;
      for (let i = 0; i + 2 < n; i++) {
        const ys = [P[i], P[i + 1], P[i + 2]];
        const d = ys[0].geo.dir;
        if (ys.some(q => q.art !== '24230' || q.virtual || q.branch || q.geo.kind !== 'arc' || q.geo.dir !== d)) continue;
        if ([P[i - 1], P[i + 3]].some(q => q && q.branch)) continue;
        // det indre spor: 3 × 24130 med samme centrum
        const h = ys[0].start.h * D2R;
        const sx = ys[0].start.x - d * TRACK_SPACING * Math.sin(h), sy = ys[0].start.y + d * TRACK_SPACING * Math.cos(h);
        layout.chains.forEach((X, xi) => {
          if (xi === yi) return;
          const Q = X.pieces;
          for (let j = 0; j + 2 < Q.length; j++) {
            const xs = [Q[j], Q[j + 1], Q[j + 2]];
            if (xs.some(q => q.art !== '24130' || q.virtual || q.branch || q.geo.kind !== 'arc' || q.geo.dir !== d)) continue;
            if (Math.hypot(xs[0].start.x - sx, xs[0].start.y - sy) > 1.5 || Math.abs(norm180(xs[0].start.h - ys[0].start.h)) > 0.5) continue;
            if ([Q[j - 1], Q[j + 3]].some(q => q && q.branch)) continue;
            cands.push({ X, xi, Y, yi, xs, ys, d });
          }
        });
      }
    });
    for (const cd of shuffle(rng, cands)) {
      if (count >= want) break;
      const { X, xi, Y, yi, xs, ys, d } = cd;
      if ([...xs, ...ys].some(q => q.branch) || !ys.every(q => Y.pieces.includes(q))) continue;
      for (const variant of shuffle(rng, ['A', 'B'])) {
        const arc = () => ({ art: '24130', geo: arcG(d, 30, R1) });
        const stem = () => ({ art: '24077', geo: lineG(77.5) });
        const xp = variant === 'A' ? xs[0] : xs[2];
        const xArt = cswArt('24130', variant === 'A' ? d : -d), yArt = cswArt('24130', variant === 'A' ? -d : d);
        const ySw = variant === 'A'
          ? { art: yArt, geo: { kind: 'path', geos: [arcG(d, 30, R1), lineG(77.5)] }, branch: { dir: -d, from: 'end', geos: [arcG(-d, 30, R1)] } }
          : { art: yArt, geo: { kind: 'path', geos: [lineG(77.5), arcG(d, 30, R1)] }, branch: { dir: d, from: 'start', geos: [arcG(d, 30, R1)] } };
        const yNew = variant === 'A' ? [stem(), arc(), arc(), ySw] : [ySw, arc(), arc(), stem()];
        const k = Y.pieces.indexOf(ys[0]);
        const endBefore = ys[2].end;
        Y.pieces.splice(k, 3, ...yNew); layoutChain(Y);
        const oldX = { art: xp.art };
        xp.art = xArt;
        xp.branch = variant === 'A' ? { dir: d, from: 'start', geos: outerLeg(d, '24130') } : { dir: -d, from: 'end', geos: outerLeg(-d, '24130') };
        const revert = () => { xp.art = oldX.art; delete xp.branch; Y.pieces.splice(Y.pieces.indexOf(yNew[0]), 4, ...ys); layoutChain(Y); };
        const endAfter = yNew[3].end;
        let side = null, ok = Math.hypot(endAfter.x - endBefore.x, endAfter.y - endBefore.y) < 1 && !Object.values(spareNow(layout, inv)).some(v => v < 0);
        if (ok) {
          if (variant === 'A') {
            side = buildSide(xp.start, [
              ...outerLeg(d, '24130').map(g => ({ art: xArt, geo: g, virtual: true, near: true })),
              { ...arc(), near: true },
              { art: yArt, geo: arcG(d, 30, R1), virtual: true, near: true },
            ]);
            ok = Math.hypot(side.end.x - ySw.end.x, side.end.y - ySw.end.y) < 1.5;
          } else {
            side = buildSide(ySw.start, [
              { art: yArt, geo: arcG(d, 30, R1), virtual: true, near: true },
              { ...arc(), near: true },
              { art: xArt, geo: arcG(d, 30, R1), virtual: true, near: true },
              { art: xArt, geo: lineG(77.5), virtual: true, near: true },
            ]);
            ok = Math.hypot(side.end.x - xp.end.x, side.end.y - xp.end.y) < 1.5;
          }
        }
        if (ok) {
          // forbindelsen må ikke ramme andre sidespor eller andre kæder end de to den forbinder
          const mid = side.pieces.find(q => !q.virtual).pts;
          const hit = q => mid.some(p => Math.hypot(p.x - q.x, p.y - q.y) < CLEAR);
          ok = !layout.sides.some(sd => sd.pts.some(hit)) && !layout.chains.some((ch, ci) => ci !== xi && ci !== yi && ch.samples.some(hit));
        }
        if (!ok) { revert(); continue; }
        layout.sides.push({ type: 'crossover', pieces: side.pieces, pts: side.pts, link: [xi, yi], corner: true });
        count++;
        break;
      }
    }
    return count;
  }

  // ---------- ekstra sløjfe ----------
  // En ekstra lukket sløjfe af R1-kurver, koblet på banen med mindst to ruter. Sløjfen placeres ud fra
  // den første rute (en port på banen + bue + lige stykker + en port på sløjfen), så den ligger i
  // samme raster som resten af banen – så går den næste rute også op. Sporgrafen skal bekræfte at et
  // tog kan køre både ind og ud igen (ingen fælde); ellers fjernes sløjfen igen.
  function addExtraLoop(layout, inv, o, rng) {
    if (layout.chains.filter(c => c.kind === 'extra').length >= 2) return 0;
    const loopT = MK.topologies.find(t => t.id === 'loop');
    const m = o.margin;
    const sameTongue = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1 && Math.abs(norm180(a.h - b.h)) < 0.5;
    for (let attempt = 0; attempt < 3; attempt++) {
      const spare = spareNow(layout, inv);
      // kun R1-kurver: dér kan buesporskifterne sidde
      const sp1 = { ...spare };
      for (const p of C.CURVES) if (p.r !== R1) sp1[p.art] = 0;
      if (capacity(sp1, R1) < 360 + 60) return 0;
      const hostPorts = enumPorts(layout, spare).filter(p => p.tag !== 'raw');
      if (!hostPorts.length) return 0;
      const grid = obstacleGrid(layout);
      // 1. nogle sløjfeformer (R1) med deres porte
      const shapes = [];
      for (let t = 0; t < 60 && shapes.length < 8; t++) {
        const att = loopT.attempt(sp1, { ...o, W: 1500, H: 1500, sCurves: false, seedPairs: 0, slimSeed: false }, rng, {}, { ring: false });
        if (!att) continue;
        const ch = att.chains[0];
        Object.assign(ch, { kind: 'extra', eligible: true, cyclic: true, junc: false, start: { x: 0, y: 0, h: 0 } });
        layoutChain(ch);
        if (ch.pieces.length > 26 || C.chainsCollide([ch])) continue;
        const local = enumPorts({ chains: [ch], sides: [] }, spare).filter(p => p.tag === 'cs');
        if (!local.length) continue;
        // billeder af sløjfens spor (hver 3. prøve) til hurtig kontrol
        shapes.push({ ch, local, pts: ch.samples.filter((_, i) => i % 3 === 0) });
      }
      // forbind den lagte sløjfe med banen (ruteløseren) og kontrollér sporgrafen; ellers rulles alt tilbage
      const tryPlaced = placed => {
        const snap = structuredClone({ chains: layout.chains, sides: layout.sides });
        const fail = () => { layout.chains = snap.chains; layout.sides = snap.sides; return false; };
        layout.chains.push(placed.ch);
        const ci = layout.chains.length - 1;
        const ports = enumPorts(layout, spare);
        const A = ports.find(p => p.tag === placed.A.tag && sameTongue(p.tongue, placed.A.tongue));
        const B = ports.find(p => p.ci === ci && p.tag === 'cs' && sameTongue(p.tongue, placed.bTongue));
        let ok = false;
        if (A && B) {
          const g2 = obstacleGrid(layout);
          const cands = connect(A, B, spare, { depth: 6, maxStates: 15000, box: { x0: m, y0: m, x1: o.W - m, y1: o.H - m }, limit: 12 });
          for (const c of cands) {
            if (!clearPath(c.ch, layout, o, g2, A, B)) continue;
            commit(layout, { A, B, link: c.ch });
            ok = true;
            break;
          }
        }
        if (!ok) return fail();
        const stats = o.debug ? {} : null;
        const n = addLinks(layout, inv, o, rng, 2, { focus: ci, pairs: 5000, pick: 8, stats });
        const an = MK.graph.analyze(layout);
        if (stats) console.log('  ekstra sløjfe:', placed.ch.pieces.length, 'skinner, flere ruter', n, 'trap', an.trap, JSON.stringify(stats));
        if (n >= 1 && !an.problems.length && an.trap === 0 && an.components === 1 && !Object.values(spareNow(layout, inv)).some(v => v < 0)) return true;
        return fail();
      };
      let done = false, tries = 0;
      if (shapes.length) {
        // 2. grov friplads-kort over det der allerede ligger (celler på 20 mm, udvidet med frihøjden)
        const CELL = 20, nx = Math.ceil(o.W / CELL) + 2, ny = Math.ceil(o.H / CELL) + 2, occ = new Uint8Array(nx * ny);
        const rad = Math.ceil((CLEAR + 4) / CELL);
        const mark = q => {
          const cx = Math.floor(q.x / CELL), cy = Math.floor(q.y / CELL);
          for (let i = -rad; i <= rad; i++) for (let j = -rad; j <= rad; j++) {
            const X = cx + i, Y = cy + j;
            if (X >= 0 && Y >= 0 && X < nx && Y < ny && (i * i + j * j) * CELL * CELL <= (CLEAR + 4 + CELL) ** 2) occ[Y * nx + X] = 1;
          }
        };
        layout.chains.forEach(c => c.samples.forEach((q, i) => { if (i % 2 === 0) mark(q); }));
        layout.sides.forEach(sd => sd.pts.forEach((q, i) => { if (i % 2 === 0) mark(q); }));
        const free = q => { const X = Math.floor(q.x / CELL), Y = Math.floor(q.y / CELL); return X >= 0 && Y >= 0 && X < nx && Y < ny && !occ[Y * nx + X]; };
        const box = { x0: m, y0: m, x1: o.W - m, y1: o.H - m };
        // 3. værtsporte: bredde-først fra porten giver stillinger (med garanteret rute dertil) hvor sløjfen kan sidde
        const hosts = shuffle(rng, hostPorts.slice()).slice(0, 8);
        const deadline = Date.now() + 120;
        for (const A of hosts) {
          if (done || tries >= 10 || Date.now() > deadline) break;
          const sr = searchPort(A, spare, { depth: 4, maxStates: 2500, box, rng });
          if (!sr) continue;
          const sts = shuffle(rng, sr.r.list.slice(1));
          for (const st of sts) {
            if (done || tries >= 10) break;
            const eh = A.pose.h + 30 * st.k, e = { x: st.x, y: st.y, h: eh };
            for (const sh of shuffle(rng, shapes.slice())) {
              const B = sh.local[Math.floor(rng() * sh.local.length)];
              const phi = e.h + 180 - B.pose.h, cs = Math.cos(phi * D2R), sn = Math.sin(phi * D2R);
              const tf = p => ({ x: e.x + (p.x - B.pose.x) * cs - (p.y - B.pose.y) * sn, y: e.y + (p.x - B.pose.x) * sn + (p.y - B.pose.y) * cs, h: (p.h || 0) + phi });
              if (!sh.pts.every(p => { const q = tf(p); return free(q) && q.x >= m && q.y >= m && q.x <= o.W - m && q.y <= o.H - m; })) continue;
              const ch = structuredClone(sh.ch);
              ch.start = tf({ x: 0, y: 0, h: 0 });
              layoutChain(ch);
              if (ch.samples.some(p => p.x < m || p.y < m || p.x > o.W - m || p.y > o.H - m || grid.near(p.x, p.y, q => Math.hypot(q.x - p.x, q.y - p.y) < CLEAR + 4))) continue;
              tries++;
              if (tryPlaced({ ch, A, bTongue: tf(B.tongue) })) { done = true; break; }
            }
          }
        }
      }
      if (done) return 1;
    }
    return 0;
  }

  MK.elements.push(
    { id: 'inner', name: 'Ekstra sløjfe', desc: 'En ekstra lukket sløjfe af R1-kurver inde i eller ved siden af banen, koblet på med mindst to ruter fra ruteløseren, så toget kan køre både ind og ud igen.', apply: addExtraLoop, sometimes: 0.4 },
    { id: 'ccross', name: 'Hjørneforbindelse med buesporskifter', desc: 'Forbinder en R1-sløjfe med den parallelle R2-ring i et 90°-hjørne: buesporskifte i det indre hjørne, én 24130 imellem, og buesporskifte + 24077 + 2× 24130 som det ydre hjørne. Kræver hverken 24224 eller almindelige sporskifter.', apply: (l, i, o, r) => addCornerCross(l, i, o, r, 2) },
    { id: 'link', name: 'Frie forbindelser (ruteløser)', desc: 'Finder selv ruter mellem to sporskifter hvor som helst på banen – genveje, ekstra sløjfer og vendeforbindelser – med kurver og lige stykker der går præcist op. Ruterne kan selv få sporskifter og stationer.', apply: (l, i, o, r) => addLinks(l, i, o, r, o.maximize ? 2 + Math.floor(r() * 3) : 1) },
  );
  const cfg = { ports: 40, depth: 5, maxStates: 4000, perState: 2, ms: 60, oldPairs: 1500 };
  MK.router = { cfg, connect, makeIndex, linkFromSteps, addLinks, addCornerCross, addExtraLoop, enumPorts, solve, straightTable, clearPath, _buildLink: buildLink, _obstacleGrid: obstacleGrid, _apart: apart, _commit: commit };
})(typeof self !== 'undefined' ? self : globalThis);
