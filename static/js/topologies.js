/*
 * Grundformer (topologier). Hver grundform kan forberedes (prep) én gang pr. generering
 * og forsøges (attempt) mange gange. Et forsøg returnerer kæder i et lokalt koordinatsystem.
 */
(function (root) {
  'use strict';
  const MK = root.MK;
  const C = MK.core;
  const { TRACK_SPACING, BALLOON_GAP, RADII, RNAME, BY_ART, STRAIGHTS, cnt, lenOf, linePiece, pickW, shuffle,
    capsOf, pushArc, randomComposition, realize, slotsToPieces, sigOf, rightOf, takeArc, matchRun, composeRun,
    totalCurveDeg, endLoopSpecs, pickSpec, endLoopPieces, balloonChain, layoutChain, newRunId } = C;

  // ---------- Lukket sløjfe (punktsymmetrisk – lukker altid præcist) ----------
  function makeLoopPlan(inv, o, rng) {
    const { cap, c15 } = capsOf(inv);
    const g = pickW(rng, [1, 2, 3, 4], [3, 4, 2, 1.2]);
    let neg = 0;
    if (o.sCurves && rng() < 0.55) neg = pickW(rng, [1, 2, 3], [3, 3, 1]);
    const posUnits = 6 + neg;
    const angles = randomComposition(rng, posUnits, Math.min(g, posUnits)).map(u => u * 30);
    if (neg) angles.splice(angles.length > 1 ? 1 + Math.floor(rng() * (angles.length - 1)) : 1, 0, -neg * 30);
    if (angles.length >= 2 && rng() < 0.3 && RADII.some(r => c15[r] >= 30)) {
      const pos = angles.map((a, i) => a > 0 ? i : -1).filter(i => i >= 0);
      if (pos.length >= 2) {
        const [i, j] = shuffle(rng, pos.slice()).slice(0, 2);
        if (angles[j] >= 45) { angles[i] += 15; angles[j] -= 15; }
      }
    }
    const slots = [];
    for (const a of angles) {
      if (!pushArc(slots, rng, cap, c15, a, o)) return null;
      slots.push({ type: 'run' });
    }
    return { slots, neg };
  }

  // Parallel ydre ring: koncentriske buer 77,5 mm længere ude (R1→R2, R2→R3), samme lige stykker.
  const OUT_R = { '1': { 360: 437.5, 437.5: 515 }, '-1': { 515: 437.5, 437.5: 360 } };
  function realizeOuter(slots, inv) {
    const out = [];
    for (const sl of slots) {
      if (sl.type === 'arc') {
        const r2 = OUT_R[String(sl.dir)][sl.r]; if (!r2) return null;
        const ps = takeArc(inv, r2, sl.ang); if (!ps) return null;
        out.push({ type: 'arc', r: r2, ang: sl.ang, dir: sl.dir, pieces: ps });
      } else {
        const ps = matchRun(inv, sl.len, sl.pieces); if (!ps) return null;
        out.push({ type: 'run', len: sl.len, pieces: ps });
      }
    }
    return out;
  }

  const loop = {
    id: 'loop', name: 'Lukket sløjfe',
    desc: 'Oval, rektangel, sekskant, S-kurver … Kan få en eller to parallelle ydre ringe.',
    prep(inv) { return totalCurveDeg(inv) >= 360 - 1e-6 ? {} : null; },
    attempt(inv0, o, rng, prep, want) {
      const plan = makeLoopPlan(inv0, o, rng); if (!plan) return null;
      const inv = { ...inv0 };
      const halves = realize(plan, inv, o, rng, Math.max(o.W, o.H) * 0.85); if (!halves) return null;
      const slots = [...halves[0], ...halves[1]];
      const chains = [{ kind: 'main', pieces: slotsToPieces(slots), start: { x: 0, y: 0, h: 0 }, cyclic: true, junc: false, eligible: true }];
      let ring = false;
      if (want.ring) {
        const outer = realizeOuter(slots, inv);
        if (outer) {
          chains.push({ kind: 'ring', pieces: slotsToPieces(outer), start: rightOf({ x: 0, y: 0, h: 0 }, TRACK_SPACING), cyclic: true, junc: false, eligible: false });
          ring = true;
          // tredobbelt: endnu en ring 77,5 mm længere ude (R1 → R2 → R3 i hjørnerne)
          if (want.ring2) {
            const inv2 = { ...inv };
            const outer2 = realizeOuter(outer, inv2);
            if (outer2) {
              Object.assign(inv, inv2);
              chains.push({ kind: 'ring', pieces: slotsToPieces(outer2), start: rightOf({ x: 0, y: 0, h: 0 }, 2 * TRACK_SPACING), cyclic: true, junc: false, eligible: false });
              ring = 2;
            }
          }
        }
      }
      const k = halves[0].filter(s => s.type === 'run' && s.len > 1).length;
      const name = plan.neg ? 'Sløjfe med S-kurver' : ({ 0: 'Cirkel', 1: 'Oval', 2: 'Afrundet rektangel', 3: 'Sekskantet bane' })[k] || 'Polygon-bane';
      return { chains, sig: 'O' + (ring ? 'R'.repeat(ring) : '') + sigOf(halves[0]), name: ring === 2 ? name + ' (tresporet)' : name, ring };
    },
  };

  // ---------- Hundeben: to parallelle linjer (77,5 mm) med en vendekurve i hver ende ----------
  const dogbone = {
    id: 'dogbone', name: 'Hundeben',
    desc: 'Lukket rute foldet sammen til to parallelle spor med vendekurver i enderne. Med en sporforbindelse bliver det to vendesløjfer.',
    prep(inv) {
      // præcis sporafstand (±0,35 mm), så sporforbindelser kan lægges mellem linjerne
      let specs = endLoopSpecs(inv, TRACK_SPACING, 4, 0.35);
      if (!specs.length) specs = endLoopSpecs(inv, TRACK_SPACING, 4, 1);
      return specs.length ? { specs } : null;
    },
    attempt(inv0, o, rng, prep) {
      const inv = { ...inv0 };
      const spec = pickSpec(rng, prep.specs);
      const loop1 = endLoopPieces(spec, 1, inv); if (!loop1) return null;
      const loop2 = endLoopPieces(spec, 1, inv); if (!loop2) return null;
      const budget = {}; STRAIGHTS.forEach(p => budget[p.art] = Math.floor(cnt(inv, p.art) / 2));
      const maxRun = Math.max(o.W, o.H) * 0.7;
      const a1 = composeRun(inv, budget, rng() * maxRun, o, rng);
      const b1 = composeRun(inv, budget, rng() < 0.3 ? 0 : rng() * maxRun * 0.5, o, rng);
      const a2 = matchRun(inv, lenOf(a1), a1); if (!a2) return null;
      const b2 = matchRun(inv, lenOf(b1), b1); if (!b2) return null;
      if (lenOf(a1) + lenOf(b1) < 300) return null;
      const top = newRunId(), bottom = newRunId();
      const run = (arts, id) => arts.map(a => ({ ...linePiece(a), run: id }));
      const pieces = [...loop1, ...run([...b1, ...a2], top), ...loop2, ...run([...b2, ...a1], bottom)];
      return {
        chains: [{ kind: 'main', pieces, start: { x: 0, y: 0, h: 0 }, cyclic: true, junc: false, eligible: true }],
        sig: `D${spec.th}${RNAME[spec.Ra]}${spec.seq.map(r => RNAME[r]).join('')}|${Math.round(lenOf(a1) / 20)}|${Math.round(lenOf(b1) / 20)}`,
        name: 'Hundeben',
      };
    },
  };

  // ---------- Punkt-til-punkt med ballonsløjfe i hver ende ----------
  function makeLinePlan(inv, o, rng) {
    const { cap, c15 } = capsOf(inv);
    const k = pickW(rng, [0, 1, 2, 3], [2, 4, 3, 1.5]);
    const slots = [{ type: 'run' }];
    for (let i = 0; i < k; i++) {
      let a = pickW(rng, [30, 60, 90, 120, 150, 180], [2, 3, 4, 2, 1, 2]);
      if (o.sCurves ? rng() < 0.4 : (i > 0 && rng() < 0.15)) a = -a;
      if (i === 0 && rng() < 0.5) a = Math.abs(a);
      if (!pushArc(slots, rng, cap, c15, a, o)) return null;
      slots.push({ type: 'run' });
    }
    return { slots, k };
  }
  const p2p = {
    id: 'p2p', name: 'Punkt-til-punkt med ballonsløjfer',
    desc: 'Linje med en ballon-vendesløjfe i hver ende – toget kører uafbrudt frem og tilbage. Kræver stor plade (ca. 1,5 m pr. sløjfe).',
    prep(inv, o) {
      // reservér stykker til stationen, så sløjferne ikke bruger dem op
      const d = o.stationTracks || 0;
      const res = { ...inv };
      res['24172'] = Math.max(0, cnt(inv, '24172') - 2 - 2 * d - d * (d - 1));
      res['24188'] = Math.max(0, cnt(inv, '24188') - 2 * d - d * (d - 1));
      let specs = endLoopSpecs(res, BALLOON_GAP, 4);
      if (!specs.length) specs = endLoopSpecs(inv, BALLOON_GAP, 4);
      return specs.length && cnt(inv, '24611') + cnt(inv, '24612') >= 2 && cnt(inv, '24224') >= 2 && cnt(inv, '24172') >= 2 ? { specs } : null;
    },
    attempt(inv0, o, rng, prep) {
      const inv = { ...inv0 };
      const spec = pickSpec(rng, prep.specs);
      const balloons = [];
      for (let i = 0; i < 2; i++) {
        const hands = ['24611', '24612'].filter(h => cnt(inv, h) > 0);
        if (!hands.length) return null;
        const b = balloonChain(spec, hands[Math.floor(rng() * hands.length)], inv);
        if (!b) return null;
        balloons.push(b);
      }
      const plan = makeLinePlan(inv, o, rng); if (!plan) return null;
      const halves = realize(plan, inv, o, rng, Math.max(o.W, o.H) * 0.35); if (!halves) return null;
      const L1 = { kind: 'line', pieces: slotsToPieces(halves[0]), start: { x: 0, y: 0, h: 0 }, cyclic: false, junc: true, eligible: true };
      const L2 = { kind: 'line', pieces: slotsToPieces(halves[1]), start: { x: 0, y: 0, h: 180 }, cyclic: false, junc: true, eligible: true };
      layoutChain(L1); layoutChain(L2);
      balloons[0].start = L1.end; balloons[1].start = L2.end;
      balloons[0].attach = 0; balloons[1].attach = 1;   // sløjferne følger linjernes ender
      const name = plan.k === 0 ? 'Punkt-til-punkt med ballonsløjfer' : plan.k === 1 ? 'Ballonsløjfer, vinklet linje' : 'Ballonsløjfer, snoet linje';
      return {
        chains: [L1, L2, balloons[0], balloons[1]], name, reverseLoops: 2,
        sig: `V${spec.th}${RNAME[spec.Ra]}${spec.seq.map(r => RNAME[r]).join('')}${spec.ls.length}${spec.lv.length}|${sigOf(halves[0])}`,
      };
    },
  };

  // ---------- Ottetal: krydsning i midten og en vendekurve på hver side ----------
  // Krydsningens spor A (retning 0°) får lige stykker, spor B (retning = krydsningsvinklen)
  // drejes parallelt med k × 24224. Så er de to ben parallelle, og hver side lukkes med
  // en vendekurve – den anden side er den samme roteret 180° om krydsningens midte.
  // 24624 (dobbelt krydsningssporskifte) har samme mål som 24640 og kan sættes i stedet for den
  // (Märklin-kataloget). I ottetallet kan toget så skifte mellem de to ben og vende.
  const XING = { '24640': 1, '24649': 2, '24624': 1, '24620': 1 };
  function figure8Geom(art) {
    const c = BY_ART[art], half = c.len / 2, k = XING[art];
    let st = { x: half * Math.cos(c.ang * C.D2R), y: half * Math.sin(c.ang * C.D2R), h: c.ang };
    for (let i = 0; i < k; i++) st = C.walkGeo(st, C.arcG(-1)).end;
    return { half, k, gap: st.y, aNeed: st.x - half, len: c.len, ang: c.ang };
  }
  const figure8 = {
    id: 'figure8', name: 'Ottetal (krydsning)',
    desc: 'Lukket rute der krydser sig selv i en krydsning 24640 (24,3°) eller 24649 (48,6°). Med dobbelt krydsningssporskifte 24624 i krydset kan toget skifte ben og vende.',
    prep(inv) {
      const opts = [];
      for (const art of Object.keys(XING)) {
        if (cnt(inv, art) < 1) continue;
        const g = figure8Geom(art);
        if (cnt(inv, '24224') < 2 * g.k) continue;
        const aLine = C.findStraights(inv, g.aNeed, 1.0, 4);
        if (!aLine || !C.hasArts(inv, [...aLine, ...aLine])) continue;
        const rest = { ...inv }; rest[art]--; rest['24224'] -= 2 * g.k; aLine.forEach(a => rest[a] -= 2);
        const specs = endLoopSpecs(rest, g.gap, 4);
        if (specs.length) opts.push({ art, g, aLine, specs });
      }
      return opts.length ? { opts } : null;
    },
    attempt(inv0, o, rng, prep) {
      const inv = { ...inv0 };
      const op = prep.opts[Math.floor(rng() * prep.opts.length)];
      const { g, aLine, art } = op;
      if (!C.takeArts(inv, [art, ...aLine, ...aLine, ...Array(2 * g.k).fill('24224')])) return null;
      const spec = pickSpec(rng, op.specs);
      const east = endLoopPieces(spec, 1, inv); if (!east) return null;
      const west = endLoopPieces(spec, -1, inv); if (!west) return null;
      // valgfri forlængelse af begge ben (samme stykker på alle fire ben)
      let ext = [];
      const extOpts = STRAIGHTS.filter(p => cnt(inv, p.art) >= 4).map(p => p.art);
      if (extOpts.length && rng() < 0.7) {
        const n = 1 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) { const a = extOpts[Math.floor(rng() * extOpts.length)]; if (cnt(inv, a) >= 4) { ext.push(a); inv[a] -= 4; } }
      }
      const id = () => newRunId();
      const run = (arts, rid) => arts.map(a => ({ ...linePiece(a), run: rid }));
      const xl = arts => arts.map(a => ({ ...linePiece(a), xing: true }));
      const xa = dir => Array.from({ length: g.k }, () => ({ art: '24224', geo: C.arcG(dir), xing: true }));
      const extR = ext.slice().reverse();
      const pieces = [
        { art, geo: C.lineG(g.len), xing: true },
        ...xl(aLine), ...run(ext, id()),
        ...east,
        ...run(extR, id()),
        ...xa(1),
        { art, geo: C.lineG(g.len), xing: true, virtual: true },
        ...xa(-1),
        ...run(ext, id()),
        ...west,
        ...run(extR, id()),
        ...xl(aLine.slice().reverse()),
      ];
      return {
        chains: [{ kind: 'main', pieces, start: { x: -g.half, y: 0, h: 0 }, cyclic: true, junc: false, eligible: true }],
        sig: `8${art}${spec.th}${RNAME[spec.Ra]}${spec.seq.map(r => RNAME[r]).join('')}${ext.join('')}`,
        name: (art === '24624' || art === '24620') ? 'Ottetal med krydsningssporskifte' : 'Ottetal',
        dslip: art === '24624' || art === '24620',
      };
    },
  };

  // ---------- Fri sløjfe: søgt på gitteret (lattice.js), ingen skabelon og ingen symmetri ----------
  // En lukket sløjfe er en vej fra startstillingen S tilbage til S med samlet drejning ±12 skridt (360°). Vejen
  // deles i to halvdele fra S: F kører frem, G (den anden halvdel) kører baglæns fra S. G er F-søgningens
  // billede drejet 180° om S, så der skal kun søges én gang: en F-tilstand (p, k) og en G'-tilstand (−p, k)
  // giver en lukket sløjfe, F efterfulgt af G' baglæns – eksakt, som sammenligning af heltal. Uden S-kurver
  // søges F med kun venstrebuer og G' med kun højrebuer (de bliver til venstrebuer, når G' køres baglæns).
  // Hver gang søges med et tilfældigt udvalg af radier og lige længder, så formerne varierer.
  const LT = MK.lattice;
  let FREE_S = null;
  const freeSteps = () => FREE_S || (FREE_S = LT.stepsFor({}, { noMacros: true }));
  const free = {
    id: 'free', name: 'Fri sløjfe',
    desc: 'Lukket sløjfe fundet ved søgning på C-sporets 30°-gitter: ikke nødvendigvis symmetrisk, med L-, U- og foldede former. Tager gerne hele pladen.',
    prep(inv) { return totalCurveDeg(inv) >= 360 - 1e-6 ? {} : null; },
    attempt(inv0, o, rng, prep, want) {
      const S = freeSteps();
      const caps0 = S.capsFor(inv0);
      // tilfældigt udvalg: 1–2 radier med nok buer til en halv sløjfe og 1–3 længdeklasser
      const arcRes = S.res.map((r, i) => r.kind === 'A' && caps0[i] >= 6 ? i : -1).filter(i => i >= 0);
      const lenRes = S.res.map((r, i) => r.kind === 'L' && caps0[i] >= 2 ? i : -1).filter(i => i >= 0);
      if (!arcRes.length) return null;
      const pickK = (arr, k) => shuffle(rng, arr.slice()).slice(0, Math.min(k, arr.length));
      const caps = new Int32Array(caps0.length);
      for (const i of pickK(arcRes, rng() < 0.5 ? 1 : 2)) caps[i] = caps0[i] >> 1;
      for (const i of pickK(lenRes, 1 + Math.floor(rng() * 3))) caps[i] = caps0[i] >> 1;
      const iw = o.W - 2 * o.margin, ih = o.H - 2 * o.margin;
      const swap = rng() < 0.5, bw = swap ? ih : iw, bh = swap ? iw : ih;
      const box = { x0: -bw, y0: -bh, x1: bw, y1: bh };
      const cw = rng() < 0.5;                                    // retning: den ene søgning kun venstre, den anden kun højre
      const bo = { depth: 6, maxStates: 7000, box, caps, rng, maxTurn: 7 };
      let F, G;
      if (o.sCurves && rng() < 0.6) { F = G = LT.bfs({ x: 0, y: 0, h: 0 }, S, bo); }
      else { F = LT.bfs({ x: 0, y: 0, h: 0 }, S, { ...bo, dir: cw ? -1 : 1 }); G = LT.bfs({ x: 0, y: 0, h: 0 }, S, { ...bo, dir: cw ? 1 : -1 }); }
      // møder: F-tilstand (p, k) og G'-tilstand (−p, k) med samlet drejning ±12
      const meets = [];
      for (const f of F.list) {
        const g = G.states.get(LT.hkey(-f.p[0], -f.p[1], -f.p[2], -f.p[3], f.k));
        if (!g) continue;
        for (const nf of f.nodes) for (const ng of g.nodes) {
          if (nf.depth + ng.depth === 0) continue;
          if (Math.abs(nf.turn - ng.turn) === 12) meets.push({ nf, ng, pcs: nf.pcs + ng.pcs });
        }
      }
      if (!meets.length) return null;
      // prøv nogle møder: byg sløjfen, mål den mod pladen, vælg en der fylder (med lidt tilfældighed)
      shuffle(rng, meets);
      let best = null;
      for (const m of meets.slice(0, 24)) {
        const sp = { ...inv0 };
        const sf = LT.pathSteps(m.nf, S), sg = LT.pathSteps(m.ng, S);
        const pf = LT.buildPieces(sf, sp); if (!pf) continue;
        const pg = LT.buildPieces(sg, sp); if (!pg) continue;
        const pieces = LT.mergeRuns([...pf, ...revPieces(pg)]);
        if (pieces.length < 8) continue;
        const ch = { kind: 'main', pieces, start: { x: 0, y: 0, h: 0 }, cyclic: true, junc: false, eligible: true };
        layoutChain(ch);
        if (Math.hypot(ch.end.x - ch.start.x, ch.end.y - ch.start.y) > 0.5) continue;
        const bb = C.bbox(ch.samples);
        const fits = (bb.w <= iw && bb.h <= ih) || (bb.w <= ih && bb.h <= iw);
        if (!fits || C.chainsCollide([ch])) continue;
        // vægt: fylder pladen, og helst mange knæk og gerne højresving (L-, U- og S-former frem for ovaler)
        const fill = Math.min(1, bb.w * bb.h / (iw * ih));
        const loopDirs = [...sf.filter(s => s.kind === 'A').map(s => s.dir), ...sg.filter(s => s.kind === 'A').map(s => -s.dir)];
        const sign = Math.sign(m.nf.turn - m.ng.turn);
        const arcs = loopDirs, reflex = loopDirs.some(d => d !== sign) ? 1 : 0;
        const shape = o.areas && o.areas.length
          ? 0.7 * Math.min(1, bb.h / ih) + 0.45 * reflex + 0.25 * Math.min(arcs.length, 8) / 8
          : 0;
        const sc = fill + 0.12 * Math.min(arcs.length, 8) + 0.3 * reflex + shape + 0.35 * rng();
        if (!best || sc > best.sc) best = { sc, ch, sf, sg, bb };
      }
      if (!best) return null;
      const sig = 'Z' + [...best.sf, '|', ...best.sg].map(s => s === '|' ? '|' : s.kind === 'L' ? 'L' + s.cls.u + 'x' + s.n : s.name + (s.dir > 0 ? '+' : '-') + s.m).join('');
      return { chains: [best.ch], sig, name: 'Fri sløjfe' };
    },
  };
  // baglæns: stykkerne i modsat rækkefølge, buer vendt
  const revPieces = ps => ps.slice().reverse().map(p => ({ ...p, geo: p.geo.kind === 'arc' ? { ...p.geo, dir: -p.geo.dir } : p.geo }));

  MK.topologies = [loop, dogbone, p2p, figure8, free];
})(typeof self !== 'undefined' ? self : globalThis);
