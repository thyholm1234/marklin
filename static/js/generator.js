/*
 * Generator: vælger blandt de tilladte grundformer, finder mange gyldige kandidater,
 * vokser dem (flere skinner) og sammensætter derefter elementerne (Fra / Kan / Skal).
 *
 * Mål "flest skinner" (o.maximize): kandidaterne vokses ved at indsætte lige stykker
 * parvis to steder hvor sporet kører i modsat retning (så banen stadig lukker præcist),
 * alle elementer forsøges, og den bane der bruger flest stykker vinder.
 */
(function (root) {
  'use strict';
  const MK = root.MK;
  const C = MK.core;
  const { D2R, CATALOG, STRAIGHTS, BY_ART, RNAME, mulberry32, pickW, shuffle, cnt, geoLen, linePiece, norm180,
    layoutChain, chainsCollide, bbox, usageOf, spareOf, obstaclePts, newRunId } = C;

  const TOPO_W = { loop: 3, dogbone: 1.6, p2p: 1.4, figure8: 1.8, free: 3 };

  function makeTf(f, o, innerW, innerH, shift = { x: 0, y: 0 }) {
    const c = Math.cos(f.rot * D2R), s = Math.sin(f.rot * D2R);
    const tx = o.margin + (innerW - f.b.w) / 2 - f.b.x0 + shift.x;
    const ty = o.margin + (innerH - f.b.h) / 2 - f.b.y0 + shift.y;
    return st => ({ x: st.x * c - st.y * s + tx, y: st.x * s + st.y * c + ty, h: (st.h || 0) + f.rot });
  }
  function spaceCoverage(points, o) {
    if (!points.length) return 0;
    const targets = [
      { x: o.margin, y: o.margin }, { x: o.W - o.margin, y: o.margin },
      { x: o.margin, y: o.H - o.margin }, { x: o.W - o.margin, y: o.H - o.margin },
      ...(o.areas || []).flat(),
    ];
    let score = 0;
    for (const t of targets) {
      let d2 = Infinity;
      for (let i = 0; i < points.length; i++) { const dx = points[i].x - t.x, dy = points[i].y - t.y, e = dx * dx + dy * dy; if (e < d2) d2 = e; }
      score += Math.max(0, 1 - Math.sqrt(d2) / 700);
    }
    return score / targets.length;
  }
  /** De frie celler (raster 200 mm uden for forbudsområderne). Afhænger kun af o, så de gemmes på o. */
  function freeCellsOf(o) {
    if (o.freeCells) return o.freeCells;
    const free = [];
    if (o.areas && o.areas.length) {
      for (let x = o.margin; x <= o.W - o.margin; x += 200) {
        for (let y = o.margin; y <= o.H - o.margin; y += 200) {
          if (!o.areas.some(a => C.insidePolygon({ x, y }, a))) free.push({ x, y });
        }
      }
    }
    return o.freeCells = free;
  }
  function freeSpaceCoverage(points, o) {
    if (!points.length || !o.areas || !o.areas.length) return 0;
    const free = freeCellsOf(o);
    if (!free.length) return 0;
    const g = new C.Grid(110);
    for (let i = 0; i < points.length; i++) g.add(points[i]);
    let covered = 0;
    for (const q of free) if (g.near(q.x, q.y, p => Math.hypot(p.x - q.x, p.y - q.y) < 110)) covered++;
    return covered / free.length;
  }
  function placementFor(chains, f, o, innerW, innerH) {
    if (!o.areas || !o.areas.length) return { x: 0, y: 0 };
    const maxX = (innerW - f.b.w) / 2, maxY = (innerH - f.b.h) / 2;
    const values = n => {
      const step = 200;
      const out = [];
      for (let x = -n; x <= n; x += step) out.push(Math.round(x));
      if (!out.includes(Math.round(n))) out.push(Math.round(n));
      return out;
    };
    const c = Math.cos(f.rot * D2R), s = Math.sin(f.rot * D2R);
    // punkterne drejes én gang; pr. forskydning flyttes de bare (objekterne genbruges)
    const rot = [];
    for (const ch of chains) for (const p of ch.samples) rot.push({ rx: p.x * c - p.y * s, ry: p.x * s + p.y * c });
    const points = rot.map(() => ({ x: 0, y: 0 }));
    let best = null;
    for (const x of values(maxX)) for (const y of values(maxY)) {
      const tx = o.margin + (innerW - f.b.w) / 2 - f.b.x0 + x;
      const ty = o.margin + (innerH - f.b.h) / 2 - f.b.y0 + y;
      for (let i = 0; i < rot.length; i++) { points[i].x = rot[i].rx + tx; points[i].y = rot[i].ry + ty; }
      if (!C.pointsClearAreas(points, o.areas)) continue;
      const b = C.bbox(points);
      const edgeUse = (b.x1 - b.x0) + (b.y1 - b.y0);
      const edgeReach = -Math.abs(b.x0 - o.margin) - Math.abs(b.y0 - o.margin)
        - Math.abs(b.x1 - (o.W - o.margin)) - Math.abs(b.y1 - (o.H - o.margin));
      const score = edgeUse * 2 + edgeReach + spaceCoverage(points, o) * 1000 + freeSpaceCoverage(points, o) * 3000;
      if (!best || score > best.score) best = { x, y, score };
    }
    return best ? { x: best.x, y: best.y } : null;
  }
  function fitsOf(chains, innerW, innerH) {
    // omskrevet kasse for drejning 0° og 90° i én gennemgang (ingen mellemlister)
    const out = [];
    const rots = [0, 90].map(rot => ({ rot, c: Math.cos(rot * D2R), s: Math.sin(rot * D2R), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
    for (let ci = 0; ci < chains.length; ci++) {
      const S = chains[ci].samples;
      for (let i = 0; i < S.length; i++) {
        const px = S[i].x, py = S[i].y;
        for (let r = 0; r < 2; r++) {
          const R = rots[r], x = px * R.c - py * R.s, y = px * R.s + py * R.c;
          if (x < R.x0) R.x0 = x; if (x > R.x1) R.x1 = x; if (y < R.y0) R.y0 = y; if (y > R.y1) R.y1 = y;
        }
      }
    }
    for (const R of rots) {
      const b = { x0: R.x0, y0: R.y0, x1: R.x1, y1: R.y1, w: R.x1 - R.x0, h: R.y1 - R.y0 };
      if (b.w <= innerW && b.h <= innerH) out.push({ rot: R.rot, b });
    }
    return out;
  }
  const relayout = chains => chains.forEach(c => { if (c.attach !== undefined) c.start = chains[c.attach].end; layoutChain(c); });
  const countUsed = layout => Object.values(usageOf(layout)).reduce((a, b) => a + b, 0);

  // ---------- vækst: flere skinner uden at bryde lukningen ----------
  // En sekvens med samlet drejning 0 (lige stykke, S-kurve, forskydning) indsat to steder hvor
  // sporet kører i modsat retning, giver modsatte forskydninger der ophæver hinanden.
  const ART30 = C.ART30;
  function insertOptions(spare, need, rng) {
    const opts = [];
    for (const p of STRAIGHTS) if (spare[p.art] >= need) opts.push({ w: spare[p.art], seq: () => [{ ...linePiece(p.art) }] });
    for (const r of C.RADII) {
      const a = ART30[r];
      if (spare[a] >= 2 * need) {
        const sgn = rng() < 0.5 ? 1 : -1;
        const arc = d => ({ art: a, geo: C.arcG(d, 30, r) });
        opts.push({ w: spare[a] * 0.8, seq: () => [arc(sgn), arc(-sgn)] });
        const ls = STRAIGHTS.filter(p => spare[p.art] >= need);
        if (ls.length) {
          const l = ls[Math.floor(rng() * ls.length)].art;
          opts.push({ w: spare[a] * 0.5, seq: () => [arc(sgn), { ...linePiece(l) }, arc(-sgn)] });
        }
      }
    }
    return opts;
  }
  function growLayout(chains, inv, o, rng, deadline, reserve, innerW, innerH) {
    const ringIdx = chains.findIndex(c => c.kind === 'ring');
    const keepCurves = !o.allSwitches || rng() < 0.5;
    const okB = (ch, k) => {
      const a = ch.pieces[k - 1] || (ch.cyclic ? ch.pieces[ch.pieces.length - 1] : null), b = ch.pieces[k];
      if (keepCurves && a && b && a.geo.kind === 'arc' && b.geo.kind === 'arc') return false;   // kurver holdes intakte (til buesporskifter)
      return [a, b].every(p => !p || (!p.virtual && !p.branch && !p.xing));
    };
    const headAt = (ch, k) => k < ch.pieces.length ? ch.pieces[k].start.h : ch.end.h;
    const runAt = (ch, k) => {
      const a = ch.pieces[k - 1], b = ch.pieces[k];
      if (a && a.run !== undefined) return a.run;
      if (b && b.run !== undefined) return b.run;
      return newRunId();
    };
    const valid = () => chains.every(c => !c.cyclic || Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y) < 3) &&
      fitsOf(chains, innerW, innerH).length && !chainsCollide(chains);
    let added = 0, fails = 0;
    while (Date.now() < deadline && fails < 150) {
      const spare = spareOf(inv, usageOf({ chains, sides: [] }));
      for (const a in reserve) spare[a] -= reserve[a];
      if (ringIdx >= 0) {
        // dobbeltspor: forlæng to modsatrettede strækninger på både hovedspor og ring
        const main = chains[0], ring = chains[ringIdx];
        const rm = C.collectRuns({ chains: [main] }, () => true), rr = C.collectRuns({ chains: [ring] }, () => true);
        if (rm.length !== rr.length || rm.length < 2) break;
        const types = STRAIGHTS.filter(p => spare[p.art] >= 4);
        if (!types.length) break;
        const pairs = [];
        for (let x = 0; x < rm.length; x++) for (let y = x + 1; y < rm.length; y++) if (Math.abs(norm180(rm[x].h - rm[y].h - 180)) < 0.02) pairs.push([x, y]);
        if (!pairs.length) break;
        const [x, y] = pairs[Math.floor(rng() * pairs.length)];
        const art = pickW(rng, types, types.map(p => spare[p.art])).art;
        const ops = [[main, rm[x].idx[0], rm[x].run], [main, rm[y].idx[0], rm[y].run], [ring, rr[x].idx[0], rr[x].run], [ring, rr[y].idx[0], rr[y].run]];
        const byChain = new Map();
        ops.forEach(([c, k, run]) => { if (!byChain.has(c)) byChain.set(c, []); byChain.get(c).push([k, run]); });
        byChain.forEach((list, c) => list.sort((a, b) => b[0] - a[0]).forEach(([k, run]) => c.pieces.splice(k, 0, { ...linePiece(art), run })));
        relayout(chains);
        if (valid()) { added += 4; fails = 0; continue; }
        byChain.forEach((list, c) => list.slice().sort((a, b) => a[0] - b[0]).forEach(([k]) => c.pieces.splice(k, 1)));
        relayout(chains); fails++;
        continue;
      }
      const ci = Math.floor(rng() * chains.length), ch = chains[ci];
      const need = ch.cyclic ? 2 : 1;
      const opts = insertOptions(spare, need, rng);
      if (!opts.length) { fails++; if (!Object.values(spare).some(v => v > 0)) break; continue; }
      const seq = pickW(rng, opts, opts.map(x => x.w)).seq;
      const n = ch.pieces.length;
      let ins;
      if (ch.cyclic) {
        const ks = [];
        for (let k = 0; k < n; k++) if (okB(ch, k)) ks.push(k);
        const pairs = [];
        for (let x = 0; x < ks.length; x++) for (let y = x + 1; y < ks.length; y++) {
          if (Math.abs(norm180(headAt(ch, ks[x]) - headAt(ch, ks[y]) - 180)) < 0.02) pairs.push([ks[x], ks[y]]);
        }
        if (!pairs.length) { fails++; continue; }
        // foretræk diametralt modsatte steder: så forbliver banen punktsymmetrisk, og ruteløseren kan
        // spejle hver forbindelse den finder
        const sym = n % 2 === 0 ? pairs.filter(([x, y]) => y - x === n / 2) : [];
        const from = sym.length && rng() < 0.85 ? sym : pairs;
        ins = from[Math.floor(rng() * from.length)];
      } else {
        const ks = [];
        for (let k = 0; k <= n; k++) if (okB(ch, k)) ks.push(k);
        if (!ks.length) { fails++; continue; }
        ins = [ks[Math.floor(rng() * ks.length)]];
      }
      ins.sort((a, b) => b - a);
      const pieces = seq();
      const runs = ins.map(k => runAt(ch, k));
      ins.forEach((k, i) => ch.pieces.splice(k, 0, ...pieces.map(p => ({ ...p, geo: { ...p.geo }, ...(p.geo.kind === 'line' ? { run: runs[i] } : {}) }))));
      relayout(chains);
      if (valid()) { added += ins.length * pieces.length; fails = 0; continue; }
      ins.slice().sort((a, b) => a - b).forEach(k => ch.pieces.splice(k, pieces.length));   // fortryd
      relayout(chains);
      fails++;
    }
    return added;
  }

  /** Centrum hvis banen er punktsymmetrisk (alle sporpunkter har et modstykke drejet 180°), ellers null. */
  function symmetryCenter(chains) {
    const c0 = chains[0];
    let c = null;
    if (c0.cyclic && c0.pieces.length % 2 === 0) {
      const a = c0.pieces[0].start, b = c0.pieces[c0.pieces.length / 2].start;
      c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else if (!c0.cyclic && chains[1] && !chains[1].cyclic) c = { x: c0.start.x, y: c0.start.y };
    if (!c) return null;
    const g = new C.Grid(40);
    const all = chains.flatMap(ch => ch.samples);
    all.forEach(p => g.add(p));
    for (const p of all) {
      const mx = 2 * c.x - p.x, my = 2 * c.y - p.y;
      if (!g.near(mx, my, q => Math.hypot(q.x - mx, q.y - my) < 14)) return null;
    }
    return c;
  }

  // ---------- stammer til indvendige buesporskifter ----------
  // Et buesporskifte kan også ligge med hovedsporet gennem det ydre ben (77,5 mm lige + R1 30°); så
  // peger grenen ind på indersiden af kurven. Det kræver 77,5 mm lige før kurven. Her lægges et 24077
  // ind foran/efter en 24130 to steder med modsat køreretning (banen lukker stadig præcist). Ruteløseren
  // erstatter senere 24077 + 24130 med buesporskiftet, så 24077 kun "lånes" – bliver et lånt 24077 ikke
  // brugt og mangler det i lageret, kasseres kandidaten af lagerkontrollen.
  function addStems(chains, rng, pairs, innerW, innerH) {
    const rings = chains.filter(c => c.kind === 'ring');
    const joints = [];
    chains.forEach((ch, ci) => {
      if (!ch.eligible || (ch.kind !== 'main' && ch.kind !== 'line')) return;
      const P = ch.pieces, n = P.length;
      const plain = q => q && !q.virtual && !q.branch && !q.xing;
      const isArc = q => plain(q) && q.art === '24130' && q.geo.kind === 'arc';
      const isRun = q => plain(q) && q.run !== undefined && q.geo.kind === 'line';
      for (let k = 0; k < n; k++) {
        if (!isArc(P[k])) continue;
        const prev = P[k - 1] || (ch.cyclic ? P[n - 1] : null), next = P[k + 1] || (ch.cyclic ? P[0] : null);
        if (isRun(prev)) joints.push({ ch, ci, at: P[k], before: true, h: P[k].start.h });
        if (isRun(next)) joints.push({ ch, ci, at: P[k], before: false, h: P[k].end.h });
      }
    });
    const stem = () => ({ art: '24077', geo: C.lineG(77.5), stem: true });
    // en parallel ring forlænges samme sted (dér bliver 24077 liggende), så sporene stadig følges ad
    const put = j => {
      const st = [stem()];
      const J = j.before ? j.at.start : j.at.end;
      const hosts = [];
      rings.forEach((r, k) => {
        const pos = C.rightOf(J, (k + 1) * C.TRACK_SPACING);
        const q = r.pieces.find(x => x.start && Math.hypot(x.start.x - pos.x, x.start.y - pos.y) < 1.5);
        if (q) hosts.push([r, q]);
      });
      if (hosts.length !== rings.length) return null;
      j.ch.pieces.splice(j.ch.pieces.indexOf(j.at) + (j.before ? 0 : 1), 0, st[0]);
      hosts.forEach(([r, q]) => { const x = stem(); r.pieces.splice(r.pieces.indexOf(q), 0, x); st.push([r, x]); });
      return st;
    };
    const unput = (j, st) => {
      if (!st) return;
      j.ch.pieces.splice(j.ch.pieces.indexOf(st[0]), 1);
      st.slice(1).forEach(([r, x]) => r.pieces.splice(r.pieces.indexOf(x), 1));
    };
    const ok = () => chains.every(c => !c.cyclic || Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y) < 3) && fitsOf(chains, innerW, innerH).length && !chainsCollide(chains);
    let added = 0;
    for (let t = 0; t < 12 && added < pairs; t++) {
      const a = joints[Math.floor(rng() * joints.length)];
      if (!a || a.used) continue;
      let group = [a];
      if (a.ch.cyclic) {
        const partners = joints.filter(b => b.ch === a.ch && !b.used && b.at !== a.at && Math.abs(norm180(b.h - a.h - 180)) < 0.02);
        if (!partners.length) continue;
        group.push(partners[Math.floor(rng() * partners.length)]);
      }
      const stems = group.map(put);
      relayout(chains);
      if (stems.every(Boolean) && ok()) { group.forEach(j => { j.used = true; }); added++; continue; }
      group.forEach((j, i) => unput(j, stems[i]));
      relayout(chains);
    }
    return added;
  }

  // ---------- point: klassiske modelbane-dyder ----------
  // Vægtene er valgt så rækkefølgen bliver: ingen manglende 'Skal'-elementer ≫ ingen blindspor uden
  // prelbuk ≫ vendesløjfer og dobbeltrettet ring ≫ stationer (eksponentielt i antal spor) ≫ øvrigt.
  const W8 = {
    missing: -5000,          // pr. 'Skal'-element der ikke kunne placeres
    noBuffer: -3000,         // pr. blindspor uden prelbuk (kæmpe straf)
    angled: -120,            // blindspor uden 24224 (stikker ud i 24,3°)
    deadEnd: -40,            // pr. almindeligt blindspor med prelbuk
    unusedSwitch: -250,      // pr. ubrugt sporskifte når "Brug alle sporskifter" er valgt
    reverse: 900,            // toget kan vende uden at bakke (målt på sporgrafen) …
    reverseBoth: 500,        // … og ekstra når det kan vende i begge køreretninger
    trap: -25,               // pr. skinne et tog kan køre ind på, men ikke komme ud fra igen uden at bakke
    routes: 70,              // pr. uafhængig rute ud over den første (maks. 12) – flere veje gennem banen
    ringBidir: 1200,         // pr. parallel ring med ≥2 sporforbindelser (dobbeltrettet drift)
    ringOne: 300,            // pr. parallel ring med kun én forbindelse
    crossover: 40,           // pr. sporforbindelse
    station: 30,             // station med n spor i alt: 30 · 2^n  (2 spor 120, 3 spor 240, 4 spor 480, 5 spor 960)
    compact: 200,            // · (1 − sporets udstrækning / pladens areal)
    density: 250,            // · skinnelængde pr. m² udstrækning (normeret)
    piece: 6,                // pr. brugt skinne ("Brug flest mulige skinner")
    pieceLite: 1,
  };
  function scoreLayout({ layout, chains, used, station, an, missing, unused, nUsed, o, innerW, innerH }) {
    const p = {};
    p.missing = missing.length * W8.missing;
    const dead = layout.sides.filter(sd => sd.type === 'blindspor');
    const noBuf = dead.filter(sd => !sd.pieces.some(q => q.buffer)).length;
    const angled = dead.filter(sd => sd.pieces.some(q => q.buffer) && sd.rough).length;
    p.deadEnds = noBuf * W8.noBuffer + angled * W8.angled + (dead.length - noBuf - angled) * W8.deadEnd;
    p.switches = o.allSwitches ? unused * W8.unusedSwitch : 0;
    p.reverse = (an.reverse ? W8.reverse : 0) + (an.reverse > 1 ? W8.reverseBoth : 0);
    p.routes = Math.min(12, Math.max(0, an.routes - 1)) * W8.routes;
    p.trap = Math.max(-1500, an.trap * W8.trap + Math.round((1 - an.covered) * 100) * W8.trap);
    let rings = 0;
    chains.forEach((c, i) => {
      if (c.kind !== 'ring') return;
      const k = layout.sides.filter(sd => sd.link && sd.link.includes(i)).length;
      rings += k >= 2 ? W8.ringBidir : k ? W8.ringOne : 0;
    });
    p.ring = rings;
    p.crossover = (used.crossover || 0) * W8.crossover;
    const st = n => W8.station * 2 ** n;
    let stations = station && station.tracks ? st(station.tracks + 1) : 0;
    for (const sd of layout.sides) if (sd.st) stations += st(sd.st + 1);
    stations += (used.passing || 0) * st(2);
    p.station = stations;
    const bb = bbox(obstaclePts(layout)), area = Math.max(1, bb.w * bb.h);
    p.compact = W8.compact * Math.max(0, 1 - area / (innerW * innerH));
    const trackLen = [...layout.chains.flatMap(c => c.pieces), ...layout.sides.flatMap(sd => sd.pieces)].filter(q => !q.virtual).reduce((a, q) => a + geoLen(q.geo), 0);
    p.density = W8.density * Math.min(1, trackLen / area * 1000 / 8);   // 8 m spor pr. m² = fuld score
    p.pieces = nUsed * (o.maximize ? W8.piece : W8.pieceLite);
    p.total = Object.values(p).reduce((a, b) => a + b, 0);
    return p;
  }

  // ---------- sammenhæng: alt der er fælles for generate og sessionen ----------
  /** Samler indstillinger, tilladte grundformer og faste størrelser. Returnerer { error } hvis ingen grundform kan bygges. */
  function makeContext(inv, opts) {
    const o = Object.assign({
      W: 2000, H: 1200, margin: 50, sCurves: true, largeRadius: false,
      stationTracks: 1, point: null, timeBudget: 700, maxAttempts: 200000, maximize: false, allSwitches: false,
      seed: Date.now() & 0xffffffff, avoid: [], onProgress: null,
      topologies: { loop: true, dogbone: true, p2p: true, figure8: true },
      elements: {},           // id -> 'off' | 'may' | 'must'  (standard 'may')
    }, opts);
    const mode = id => o.elements[id] || 'may';
    const rng = mulberry32(o.seed);
    o.seedPairs = Math.max(o.stationTracks || 0, mode('crossover') !== 'off' || mode('wye') !== 'off' ? 1 : 0);
    o.slimSeed = mode('spassing') !== 'off' && cnt(inv, '24711') > 0 && cnt(inv, '24712') > 0 && cnt(inv, '24912') >= 2;
    const progress = (msg, extra) => { if (o.onProgress) try { o.onProgress({ msg, ...extra }); } catch (e) { /* ignorer */ } };
    // forbered tilladte grundformer
    const ringMust = mode('ring') === 'must';
    const topos = [], failed = [];
    for (const t of MK.topologies) {
      if (o.topologies[t.id] === false) continue;
      if (ringMust && t.id !== 'loop') continue;
      const prep = t.prep(inv, o);
      if (prep) topos.push({ t, prep }); else failed.push(t.name);
    }
    if (!topos.length) {
      return { error: 'Ingen af de valgte grundformer kan bygges med lageret' + (failed.length ? ` (${failed.join(', ')})` : '') + '. Tilføj flere kurver/sporskifter eller tillad flere grundformer.' };
    }
    const d = o.stationTracks || 0;
    const SW = MK.switches.SWITCH_ARTS;
    return {
      inv, o, mode, rng, progress, topos, ringMust, tripleRingMust: mode('ring3') === 'must',
      avoid: new Set(o.avoid),
      innerW: o.W - 2 * o.margin, innerH: o.H - 2 * o.margin, diag: Math.hypot(o.W, o.H),
      totalPieces: CATALOG.reduce((a, p) => a + cnt(inv, p.art), 0),
      long: o.maximize || o.allSwitches,
      switchesTotal: SW.reduce((a, x) => a + cnt(inv, x), 0),
      musts: MK.elements.filter(e => mode(e.id) === 'must' && e.apply).map(e => e.id),
      reserve: { '24188': 2 * d + d * (d - 1) + 2, '24172': 2 * d + d * (d - 1) + 2 },
      // fase 1
      tw: topos.map(x => {
        if (!o.areas || !o.areas.length) return TOPO_W[x.t.id] || 1;
        if (x.t.id === 'loop') return 2;
        if (x.t.id === 'free') return 20;
        return TOPO_W[x.t.id] || 1;
      }),
      seen: new Set(), cands: [], attempts: 0, ringFound: false, lastP: 0,
    };
  }

  // ---------- fase 1 (T0): gyldige grundformer ----------
  /** Finder grundformer til ctx.cands indtil fristen, maxNew nye er fundet, eller forsøgene er brugt. Returnerer antal nye. */
  function findBases(ctx, until, maxNew = Infinity) {
    const { inv, o, mode, rng, topos, tw, innerW, innerH, diag, totalPieces, avoid, seen, cands } = ctx;
    let found = 0;
    while (ctx.attempts < o.maxAttempts && found < maxNew && Date.now() < until) {
      ctx.attempts++;
      if (Date.now() - ctx.lastP > 250) { ctx.lastP = Date.now(); ctx.progress('Finder grundformer', { attempts: ctx.attempts, valid: cands.length }); }
      const tp = pickW(rng, topos, tw);
      const want = {
        ring: mode('ring') === 'must' || (mode('ring') === 'may' && rng() < (o.areas && o.areas.length ? 0.9 : 0.5)),
        ring2: mode('ring3') === 'must' || (mode('ring3') === 'may' && rng() < (o.areas && o.areas.length ? 0.75 : 0.45)),
      };
      const att = tp.t.attempt(inv, o, rng, tp.prep, want);
      if (!att) continue;
      if (ctx.tripleRingMust && att.ring !== 2) continue;
      if (seen.has(att.sig)) continue; seen.add(att.sig);
      if (ctx.ringMust && !att.ring) continue;
      att.topo = tp.t.id;
      att.chains.forEach(layoutChain);
      if (att.chains.some(ch => ch.cyclic && Math.hypot(ch.end.x - ch.start.x, ch.end.y - ch.start.y) > 3)) continue;
      const fits = fitsOf(att.chains, innerW, innerH);
      if (!fits.length) continue;
      if (chainsCollide(att.chains)) continue;
      const layout = { chains: att.chains, sides: [] };
      const nPieces = countUsed(layout);
      for (const f of fits) {
        f.offset = placementFor(att.chains, f, o, innerW, innerH);
        if (!f.offset) continue;
        const tf = makeTf(f, o, innerW, innerH, f.offset);
        let st = 0;
        if (o.stationTracks) {
          const so = MK.station.stationOptions(layout, inv, o.stationTracks, o.point, tf);
          st = so.length ? Math.max(...so.map(x => x.d / o.stationTracks - 1.5 * x.dist / diag + 0.25 * Math.min(x.usable / 600, 1))) : -0.6;
        }
        const fill = (f.b.w * f.b.h) / (innerW * innerH);
        const fillT = mode('stub') === 'must' ? 0.5 - Math.abs(fill - 0.4) : fill;
        // forsortering: vendesløjfer og ringe skal med i finalerunden (de giver mange point senere)
        const virtue = 0.3 * (att.reverseLoops || 0) + (att.dslip ? 0.3 : 0) + (att.ring ? 0.3 * att.ring : 0);
        // plads indeni: ruteløseren skal kunne lægge ruter og sløjfer inde i banen (R1-sløjfe ≈ 800 mm)
        const room = Math.min(1, Math.min(f.b.w, f.b.h) / Math.min(1250, Math.min(innerW, innerH)));
        const c = Math.cos(f.rot * D2R), s = Math.sin(f.rot * D2R);
        const tx = o.margin + (innerW - f.b.w) / 2 - f.b.x0 + f.offset.x;
        const ty = o.margin + (innerH - f.b.h) / 2 - f.b.y0 + f.offset.y;
        const placed = [];
        for (const ch of att.chains) for (const p of ch.samples) placed.push({ x: p.x * c - p.y * s + tx, y: p.x * s + p.y * c + ty });
        const coverage = spaceCoverage(placed, o);
        const freeCoverage = freeSpaceCoverage(placed, o);
        f.score = o.maximize
          ? 1.2 * nPieces / Math.max(1, totalPieces) + 0.35 * room + 0.4 * st + virtue + 0.25 * rng()
          : 0.45 * fillT + 0.3 * nPieces / Math.max(1, totalPieces) + 0.7 * st + virtue + 0.12 * rng();
        if (o.areas && o.areas.length) f.score += 0.9 * coverage;
        if (o.areas && o.areas.length) f.score += 6 * freeCoverage;
      }
      fits.sort((a, b) => b.score - a.score);
      if (att.ring) ctx.ringFound = true;
      cands.push({ att, rot: fits[0].rot, b: fits[0].b, offset: fits[0].offset, score: fits[0].score, avoided: avoid.has(att.sig), topo: att.topo, sig: att.sig });
      found++;
    }
    return found;
  }

  // ---------- fase 2: trin ----------
  // T1: grundform → vokset, evt. med stammer, placeret på pladen. valg = { frac, stems }; growMs = væksttid ved frac 1.
  function stepGrow(ctx, base, valg, growMs, timing) {
    const { inv, o, rng, innerW, innerH, reserve } = ctx;
    const chains = C.cloneChains(base.att.chains);
    let f = { rot: base.rot, b: base.b, offset: base.offset || { x: 0, y: 0 } };
    let stemmed = 0;
    if (o.maximize) {
      const per = growMs * valg.frac;
      const tG = Date.now();
      if (per > 0) growLayout(chains, inv, o, rng, o.noTime ? Infinity : Date.now() + per, reserve, innerW, innerH);
      if (timing) timing.grow = (timing.grow || 0) + Date.now() - tG;
      if (valg.stems) stemmed = addStems(chains, rng, 1 + Math.floor(rng() * 2), innerW, innerH);
      const fs = fitsOf(chains, innerW, innerH);
      if (!fs.length) return null;
      fs.sort((a, b) => (a.b.w * a.b.h) - (b.b.w * b.b.h));
      f = fs[Math.floor(rng() * fs.length)];
      f.offset = placementFor(chains, f, o, innerW, innerH);
      if (!f.offset) return null;
    }
    const tf = makeTf(f, o, innerW, innerH, f.offset);
    const layout = { chains, sides: [] };
    chains.forEach(c => { c.start = c.attach !== undefined ? chains[c.attach].end : tf(c.start); layoutChain(c); });
    if (!C.pointsClearAreas(chains.flatMap(c => c.samples), o.areas)) return null;
    layout.sym = symmetryCenter(chains);
    return { layout, used: {}, station: null, stemmed, f };
  }
  // T2: ringe forbindes med hovedsporet, løse ringe fjernes. valg.ccross = antal hjørneforbindelser (1–3).
  function stepRings(ctx, node, valg) {
    const { inv, o, mode, rng } = ctx;
    const { layout, used } = node, chains = layout.chains;
    // alt skal hænge sammen: en parallel ring skal forbindes med mindst én sporforbindelse
    if (chains.some(c => c.kind === 'ring')) {
      let n = 0;
      // buesporskifter i hjørnerne først (kræver hverken 24224 eller alm. sporskifter), så alm. sporforbindelser
      if (mode('ccross') !== 'off') { const c = MK.router.addCornerCross(layout, inv, o, rng, valg.ccross); if (c) { used.ccross = c; n += c; } }
      if (mode('crossover') !== 'off') for (let k = 0; k < 3 && n < 4; k++) { const c = MK.elements.find(e => e.id === 'crossover').apply(layout, inv, o, rng); if (c) { used.crossover = (used.crossover || 0) + c; n += c; } }
      // ringe der ikke er forbundet (direkte eller via en anden ring) med hovedsporet fjernes
      const conn = new Set(chains.map((c, i) => c.kind === 'ring' ? -1 : i).filter(i => i >= 0));
      for (let grow = true; grow;) {
        grow = false;
        for (const sd of layout.sides) if (sd.link && conn.has(sd.link[0]) !== conn.has(sd.link[1])) { sd.link.forEach(i => conn.add(i)); grow = true; }
      }
      for (let i = chains.length - 1; i >= 0; i--) {
        if (chains[i].kind !== 'ring' || conn.has(i)) continue;
        layout.sides = layout.sides.filter(sd => !(sd.link && sd.link.includes(i)));
        chains.splice(i, 1);
      }
    }
    // ringe og ballonsløjfer må også få sporskifter, stationer og ruter (sporgrafen kontrollerer resultatet)
    chains.forEach(c => { if (c.kind === 'ring' || c.kind === 'balloon') c.eligible = true; });
  }
  // Rækkefølgen af 'Kan'-elementerne: { t4: ruter og stationer, t5: sidespor }. routesFirst: ruter før stationer.
  const STATIONS = ['cfan', 'tstation', 'cstation', 'cpassing', 'spassing', 'passing'];
  function orderFor(ctx, node, routesFirst) {
    const { rng } = ctx;
    const routes = shuffle(rng, ['cutoff', 'wye', 'stub', 'link']);
    if (node.stemmed) { routes.splice(routes.indexOf('link'), 1); routes.unshift('link'); }
    return {
      t4: ['ccross', 'crossover', 'inner', ...(routesFirst ? [...routes, ...STATIONS] : [...STATIONS, ...routes])],
      t5: shuffle(rng, ['threeway', 'csiding', 'siding']),
    };
  }
  /** Ét element på banen med delfrist. again: tillad et element, der allerede er brugt (forbedringsfasen). */
  function applyElement(ctx, node, id, timing, again) {
    const { inv, o, mode, rng } = ctx;
    const el = MK.elements.find(e => e.id === id);
    if (!el || !el.apply || mode(id) === 'off' || (!again && node.used[id])) return 0;
    const tE = Date.now();
    const n = el.apply(node.layout, inv, C.subDeadline(o, id === 'inner' || id === 'link' ? 0.25 : 0.1), rng);
    if (timing) timing[id] = (timing[id] || 0) + Date.now() - tE;
    if (n) node.used[id] = (node.used[id] || 0) + n;
    return n || 0;
  }
  /** 'Skal'-elementer, derefter stationen (brugerens punkt). order = alle elementer i rækkefølge (de 'Skal' tages først). */
  function stepMust(ctx, node, order, timing) {
    const { inv, o, mode, rng } = ctx;
    for (const id of order.filter(id => mode(id) === 'must')) applyElement(ctx, node, id, timing);
    const tS = Date.now();
    node.station = MK.station.addStation(node.layout, inv, C.subDeadline(o, 0.1), rng);
    if (timing) timing.station = (timing.station || 0) + Date.now() - tS;
  }
  /**
   * 'Kan'-elementer i den givne rækkefølge. hooks.decide(id) afgør om elementet prøves; hooks.before(id) /
   * hooks.after(id, n, ms) lader kalderen måle gevinsten pr. element.
   */
  function stepCan(ctx, node, ids, hooks, timing) {
    const { mode } = ctx;
    for (const id of ids) {
      if (mode(id) === 'must' || mode(id) === 'off' || node.used[id]) continue;
      if (hooks && hooks.decide && !hooks.decide(id)) continue;
      if (hooks && hooks.before) hooks.before(id);
      const t = Date.now();
      const n = applyElement(ctx, node, id, timing);
      if (hooks && hooks.after) hooks.after(id, n, Date.now() - t);
    }
  }
  function stepFill(ctx, node, timing) {
    const { inv, o, rng } = ctx;
    const t = Date.now();
    const f = MK.switches.fillSwitches(node.layout, inv, C.subDeadline(o, 0.25), rng);
    for (const k in f) node.used[k] = (node.used[k] || 0) + f[k];
    if (timing) timing.fill = (timing.fill || 0) + Date.now() - t;
  }
  /** Sikkerhedsnet + point for en bane. Returnerer { ok:false } hvis den er ugyldig. */
  function evaluate(ctx, node) {
    const { inv, o, innerW, innerH } = ctx;
    const { layout, used, station } = node;
    const unused = MK.switches.switchesLeft(layout, inv);
    const missing = ctx.musts.filter(id => !used[id]);
    const nUsed = countUsed(layout);
    // sikkerhedsnet: alle skinneender skal mødes, og lageret må ikke overskrides
    const an = MK.graph.analyze(layout);
    if (an.problems.length || Object.values(spareOf(inv, usageOf(layout))).some(v => v < 0)) return { ok: false };
    if (!C.pointsClearAreas(obstaclePts(layout), o.areas)) return { ok: false };
    const parts = scoreLayout({ layout, chains: layout.chains, used, station, an, missing, unused, nUsed, o, innerW, innerH });
    if (o.areas && o.areas.length) {
      const covered = freeSpaceCoverage(obstaclePts(layout), o);
      parts.freeSpace = covered * 8000;
      parts.total += parts.freeSpace;
    }
    return { ok: true, parts, an, unused, missing, nUsed, total: parts.total };
  }
  /** Resultatet i det format generate returnerer. best = { node, ev, base } */
  function buildResult(ctx, best, extraStats) {
    const { inv, o, totalPieces, switchesTotal } = ctx;
    const { layout, used, station } = best.node, ev = best.ev, ch = best.base;
    for (const p of [...layout.chains.flatMap(c => c.pieces), ...layout.sides.flatMap(s => s.pieces)]) {
      if (p.branch) p.branchPtsList = C.branchPtsOf(p);
    }
    const usage = usageOf(layout);
    const arcR = layout.chains.flatMap(c => c.pieces).filter(p => p.geo.kind === 'arc' && !p.virtual && p.art !== '24224' && p.art !== '24206').map(p => p.geo.r);
    const mainLen = layout.chains.filter(c => c.kind === 'main' || c.kind === 'line').reduce((a, c) => a + c.pieces.filter(p => !p.virtual).reduce((s, p) => s + geoLen(p.geo), 0), 0);
    const ring = layout.chains.find(c => c.kind === 'ring');
    const strat = [{ id: ch.att.topo, name: ch.att.dslip ? ch.att.name : MK.topologies.find(t => t.id === ch.att.topo).name, n: 1 }];
    if (ring) strat.push({ id: 'ring', name: 'Parallel ring', n: 1 });
    if (ring && layout.chains.filter(c => c.kind === 'ring').length >= 2) {
      strat.push({ id: 'ring3', name: 'Tresporet lukket sløjfe', n: 1 });
    }
    if (station && station.tracks) strat.push({ id: 'station', name: `Station (${station.tracks + 1} spor)`, n: 1 });
    for (const e of MK.elements) if (used[e.id]) strat.push({ id: e.id, name: e.name, n: used[e.id] });
    return {
      chains: layout.chains, sides: layout.sides, used: usage, spare: spareOf(inv, usage), sig: ch.att.sig,
      station, point: o.point, strategies: strat, score: ev.parts.total, scoreParts: ev.parts,
      missing: ev.missing.map(id => MK.elements.find(e => e.id === id).name),
      stats: Object.assign({
        name: ch.att.name, topo: ch.att.topo, length: mainLen, double: !!ring, outerLength: ring ? ring.length : 0,
        reverseLoops: ev.an.reverse, bbox: bbox(obstaclePts(layout)),
        radii: [...new Set(arcR)].sort((a, b) => a - b).map(r => RNAME[r]),
        sidings: used.siding || 0, crossovers: (used.crossover || 0) + (used.ccross || 0), stationTracks: station ? station.tracks : 0,
        routes: ev.an.routes, piecesUsed: ev.nUsed, piecesTotal: totalPieces,
        switchesUsed: switchesTotal - ev.unused, switchesTotal, rough: layout.sides.filter(sd => sd.rough).length,
      }, extraStats),
    };
  }
  const noBaseError = ctx => (ctx.o.areas && ctx.o.areas.length)
    ? 'Der er ikke nok sammenhængende plads uden for forbudsområderne. Gør et område mindre, flyt det eller fjern et område.'
    : 'Kunne ikke placere en bane. Prøv igen eller med længere tænketid.';

  // ---------- generate ----------
  function generate(inv, opts) {
    const ctx = makeContext(inv, opts);
    if (ctx.error) return { error: ctx.error };
    const { o, mode, rng, avoid, long } = ctx;
    // 'flest skinner' / 'alle sporskifter': den vedvarende søgning (search.js). Kort tilstand beholder løkken herunder.
    if (long && MK.createSession && !o.legacy) return MK.createSession(inv, opts).next(o.timeBudget);
    const t0 = Date.now();
    const deadline = t0 + o.timeBudget;
    const phase1 = t0 + (long ? o.timeBudget * 0.3 : o.timeBudget);
    o.deadline = long ? deadline : deadline + 2500;       // elementerne får delfrister under denne (o.until)

    // ---------- fase 1: mange gyldige grundformer ----------
    findBases(ctx, phase1);
    const { cands } = ctx;
    let pool = cands.filter(c => !c.avoided);
    if (!pool.length) pool = cands;
    const anyMust = MK.elements.some(e => mode(e.id) === 'must' && e.apply);
    if (!o.maximize && !anyMust && mode('ring') === 'may' && ctx.ringFound && rng() < 0.5) { const r = pool.filter(c => c.att.ring); if (r.length) pool = r; }
    if (!pool.length) {
      return { error: 'Kunne ikke finde en bane der passer. Prøv en større plade, flere spor eller tillad flere grundformer.', attempts: ctx.attempts };
    }
    let list;
    if (long) {
      // bedste kandidater på tværs af grundformer, lidt tilfældighed for variation
      pool.sort((a, b) => b.score - a.score);
      list = pool.slice(0, 80);
      for (let i = 0; i < list.length - 1; i++) if (rng() < 0.25) { const j = i + 1 + Math.floor(rng() * Math.min(4, list.length - i - 1)); [list[i], list[j]] = [list[j], list[i]]; }
    } else {
      const topoIds = [...new Set(pool.map(c => c.att.topo))];
      const tid = pickW(rng, topoIds, topoIds.map(id => TOPO_W[id] || 1));
      pool.sort((a, b) => (b.att.topo === tid) - (a.att.topo === tid) || b.score - a.score);
      if (!anyMust) pool = pool.filter(c => c.att.topo === tid);
      list = pool.slice(0, Math.max(1, anyMust ? 30 : Math.min(10, Math.ceil(pool.length * 0.1))));
      shuffle(rng, list);
    }

    // ---------- fase 2: vækst + elementer ----------
    let best = null, tried = 0, invalid = 0;
    const timing = {};
    const tF = Date.now();
    for (let it = 0; it < (long ? 100000 : list.length); it++) {
      const idx = it % list.length;
      if (long && it >= list.length && Date.now() > deadline) break;
      if (best && (long ? (Date.now() > deadline || (!o.maximize && !best.ev.unused && !best.ev.missing.length)) : (!best.ev.missing.length || Date.now() - tF > 2500))) break;
      const base = list[idx];
      // valg som i den gamle generator: faste sandsynligheder
      const valg = { frac: 1, stems: false, ccross: 1 + Math.floor(rng() * 3) };
      let growMs = 0;
      if (o.maximize) {
        const left = Math.max(0, deadline - Date.now());
        // kort væksttid pr. kandidat: det er sammensætningen bagefter (ruter, stationer) der giver point,
        // så det gælder om at nå mange kandidater
        growMs = Math.max(40, Math.min(110, left / 20));
        // skal alle sporskifter med, vokses nogle kandidater mindre, så der bliver plads til sidespor
        // det samme gælder en 'Skal'-ekstra sløjfe: den skal have plads inde i eller ved siden af banen
        valg.frac = o.allSwitches || mode('inner') === 'must' ? [0, 0.15, 0.35, 0.6, 1][Math.floor(rng() * 5)] : 1;
        valg.stems = mode('link') !== 'off' && C.cnt(inv, '24671') + C.cnt(inv, '24672') > 0 && rng() < 0.75;
      }
      const node = stepGrow(ctx, base, valg, growMs, timing);
      if (!node) continue;
      tried++;
      stepRings(ctx, node, valg);
      // rækkefølge: 'Skal'-elementer, så stationen (brugerens punkt), så 'Kan'-elementer
      // frie forbindelser (ruteløseren) lægges enten før eller efter stationerne – begge dele prøves over mange forsøg
      const ord = orderFor(ctx, node, node.stemmed || rng() < 0.5);
      const all = [...ord.t4, ...ord.t5];
      stepMust(ctx, node, all, timing);
      const decide = id => {
        const m = mode(id), el = MK.elements.find(e => e.id === id);
        if (m === 'may' && !long && rng() > 0.65) return false;
        if (m === 'may' && el.sometimes && rng() > el.sometimes) return false;      // dyre elementer prøves kun i nogle forsøg
        return true;
      };
      stepCan(ctx, node, all, { decide }, timing);
      if (o.allSwitches) stepFill(ctx, node);
      const ev = evaluate(ctx, node);
      if (!ev.ok) { invalid++; continue; }
      const sc = ev.total + 0.5 * rng();
      if (!best || sc > best.sc) {
        best = { sc, node, ev, base };
        ctx.progress('Optimerer', { best: ev.nUsed, total: ctx.totalPieces, tried, swUsed: ctx.switchesTotal - ev.unused, swTotal: ctx.switchesTotal });
      }
    }
    if (!best) return { error: noBaseError(ctx), attempts: ctx.attempts };
    return buildResult(ctx, best, { timing, attempts: ctx.attempts, valid: cands.length, tried, invalid, ms: Date.now() - t0 });
  }

  MK.generate = generate;
  MK.compose = {
    addStems, symmetryCenter, growLayout, scoreLayout, placementFor, fitsOf, makeTf, spaceCoverage, freeSpaceCoverage,
    makeContext, findBases, stepGrow, stepRings, orderFor, applyElement, stepMust, stepCan, stepFill, evaluate, buildResult, noBaseError, countUsed,
  };
})(typeof self !== 'undefined' ? self : globalThis);
