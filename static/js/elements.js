/*
 * Elementer (tilføjelser) der placeres på en færdig grundform. Hvert element har
 * apply(layout, inv, o, rng) -> antal placerede. Elementerne omsorterer lige stykker
 * inden for en strækning (det ændrer ikke banens lukning) for at ramme præcise positioner.
 */
(function (root) {
  'use strict';
  const MK = root.MK;
  const C = MK.core;
  const { SW_ANG, R2, TRACK_SPACING, D2R, BY_ART, STRAIGHTS, CURVES, RADII, ART30, BALLOON_GAP,
    shuffle, cnt, lenOf, arcG, lineG, linePiece, arcPieces, handFor, norm180, cross, unit, removeArts, countOf, pickW,
    walkGeo, walkAll, layoutChain, chainsCollide, hasArts, findArcCombo, usageOf, spareOf, spareNow, findStraights,
    collectRuns, refreshRun, reorderRun, placeOne, placeTwo, switchable, obstaclePts, sideOk, buildSide, pointsState,
    endLoopSpecs, pickSpec, balloonChain, bufLeft, bufArt, R9, SLIM_ANG } = C;

  const SW_CHORD = 2 * R2 * Math.sin(SW_ANG * D2R);       // gren + 24224 langs sporet (359,8 mm)
  const axis = (o, u, p) => (p.x - o.x) * u.x + (p.y - o.y) * u.y;
  const perp = (o, u, p) => -(p.x - o.x) * u.y + (p.y - o.y) * u.x;

  /** Par af parallelle/modsatrettede lige strækninger. */
  function runPairs(layout, filter) {
    const runs = collectRuns(layout, filter);
    const out = [];
    for (let i = 0; i < runs.length; i++) for (let j = 0; j < runs.length; j++) {
      if (i === j) continue;
      const A = runs[i], B = runs[j];
      const dh = norm180(B.h - A.h);
      const par = Math.abs(dh) < 0.05, anti = Math.abs(Math.abs(dh) - 180) < 0.05;
      if (!par && !anti) continue;
      const u = unit(A.h);
      const off = perp(A.a, u, B.a);
      // overlap langs aksen
      const a0 = 0, a1 = A.len, b0 = axis(A.a, u, B.a), b1 = axis(A.a, u, B.b);
      const ov = Math.min(a1, Math.max(b0, b1)) - Math.max(a0, Math.min(b0, b1));
      if (ov < 360) continue;
      out.push({ A, B, u, off, anti, ov });
    }
    return out;
  }
  /** Sporskifte-stykke p på strækning r, med tunge ved aksepos. x og krop i retning bodyDir (+1/-1 langs u). */
  const fromFor = (r, u, bodyDir) => (Math.cos((r.h) * D2R) * u.x + Math.sin(r.h * D2R) * u.y > 0) === (bodyDir > 0) ? 'start' : 'end';

  // ---------- Sporforbindelser mellem parallelle spor (77,5 mm) ----------
  function addCrossovers(layout, inv, o, rng, want) {
    let count = 0;
    const pairs = shuffle(rng, runPairs(layout, ch => ch.eligible || ch.kind === 'ring').filter(p => Math.abs(Math.abs(p.off) - TRACK_SPACING) < 1.2));
    // mulige akse-positioner for et 24188 på strækning r (omsortering hvis strækningen er fri)
    const options = (r, u, bodyDir) => {
      const pos = Math.cos(r.h * D2R) * u.x + Math.sin(r.h * D2R) * u.y > 0;
      const a = axis(pairsOrigin, u, r.a);
      const res = [];
      const add = (off, order, index) => {
        // tungens akse-position: krop +u -> tungen ved laveste ende, krop −u -> ved højeste
        const lo = pos ? a + off : a - off - 188.3;
        res.push({ x: bodyDir > 0 ? lo : lo + 188.3, order, index });
      };
      if (r.free) {
        const others = removeArts(r.arts, ['24188']);
        if (r.arts.includes('24188')) for (const ss of C.subsetSums(others, 3000)) add(ss.sum, [...ss.pick, '24188', ...removeArts(others, ss.pick)], ss.pick.length);
      } else {
        let off = 0;
        r.arts.forEach((x, k) => { if (x === '24188' && switchable(layout.chains[r.ci], r.idx[k])) add(off, null, k); off += BY_ART[x].len; });
      }
      return res;
    };
    let pairsOrigin = null;
    for (const pr of pairs) {
      if (count >= want) break;
      for (const [T1, T2] of shuffle(rng, [[pr.A, pr.B], [pr.B, pr.A]])) {
        if (count >= want) break;
        refreshRun(layout, T1); refreshRun(layout, T2);
        if (!T1.free && !T2.free) continue;
        const u = pr.u; pairsOrigin = pr.A.a;
        const otherSide = Math.sign(perp(T1.a, u, T2.a));
        const hand = handFor(otherSide);
        if (spareNow(layout, inv)[hand] < 2) continue;
        const o1 = options(T1, u, 1), o2 = options(T2, u, -1).sort((p, q) => p.x - q.x);
        const matches = [];
        for (const a1 of o1) for (const a2 of o2) if (Math.abs(a2.x - a1.x - SW_CHORD) <= 1.0) matches.push([a1, a2]);
        let done = false;
        for (const [a1, a2] of shuffle(rng, matches).slice(0, 20)) {
          const s1 = T1.arts.slice(), s2 = T2.arts.slice();
          if (a1.order) reorderRun(layout, T1, a1.order);
          if (a2.order) reorderRun(layout, T2, a2.order);
          const ch1 = layout.chains[T1.ci], ch2 = layout.chains[T2.ci];
          const i1 = T1.idx[a1.index], i2 = T2.idx[a2.index];
          if (!switchable(ch1, i1) || !switchable(ch2, i2)) { reorderRun(layout, T1, s1); reorderRun(layout, T2, s2); continue; }
          const p1 = ch1.pieces[i1], p2 = ch2.pieces[i2];
          p1.art = hand; p1.branch = { dir: otherSide, from: fromFor(T1, u, 1) };
          p2.art = hand; p2.branch = { dir: otherSide, from: fromFor(T2, u, -1) };
          const b1 = walkGeo(pointsState(p1), arcG(otherSide)).pts, b2 = walkGeo(pointsState(p2), arcG(otherSide)).pts;
          if (Math.hypot(b1[b1.length - 1].x - b2[b2.length - 1].x, b1[b1.length - 1].y - b2[b2.length - 1].y) > 3) {
            p1.art = p2.art = '24188'; delete p1.branch; delete p2.branch;
            reorderRun(layout, T1, s1); reorderRun(layout, T2, s2); continue;
          }
          layout.sides.push({ type: 'crossover', pieces: [], pts: [...b1, ...b2], link: [T1.ci, T2.ci] });
          count++; done = true;
          break;
        }
        if (done) continue;
      }
    }
    return count;
  }

  // ---------- Station: stige af parallelle spor tættest på et punkt ----------
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function stationOptions(layout, inv, want, point, tf) {
    const spare = spareNow(layout, inv);
    const swCap = Math.min(spare['24611'], spare['24612'], Math.floor(spare['24224'] / 2));
    const out = [];
    for (const r of collectRuns(layout)) {
      if (!r.free) continue;
      const n188 = r.arts.filter(a => a === '24188').length, n172 = r.arts.filter(a => a === '24172').length;
      let d = Math.min(want, Math.floor(n188 / 2), Math.floor(n172 / 2), swCap);
      while (d > 1 && (spare['24188'] < d * (d - 1) - 2 || spare['24172'] < d * (d - 1))) d--;
      if (d < 1) continue;
      let a = r.a, b = r.b;
      if (tf) { a = tf(a); b = tf(b); }
      const P = 720 * d, L = r.len, ux = (b.x - a.x) / (L || 1), uy = (b.y - a.y) / (L || 1);
      const sh = Math.min(P / 2, L / 2);
      const a2 = { x: a.x + ux * sh, y: a.y + uy * sh }, b2 = { x: b.x - ux * sh, y: b.y - uy * sh };
      let k188 = 2 * d, k172 = 2 * d, usable = 0; const sp = { ...spare };
      for (const x of r.arts.slice().sort((p, q) => BY_ART[q].len - BY_ART[p].len)) {
        if (x === '24188' && k188 > 0) { k188--; continue; }
        if (x === '24172' && k172 > 0) { k172--; continue; }
        if (sp[x] >= d && usable < 1200) { usable += BY_ART[x].len; sp[x] -= d; }
      }
      const dist = point ? segDist(point, a2, b2) : 0;
      out.push({ run: r, d, dist, usable, val: d - dist / 800 + 0.4 * Math.min(usable / 600, 1) });
    }
    return out;
  }
  function addStation(layout, inv, o, rng) {
    const want = o.stationTracks || 0;
    if (!want) return null;
    const pt = o.point;
    const opts = stationOptions(layout, inv, want, pt);
    if (!opts.length) return { tracks: 0, want };
    opts.sort((x, y) => y.val - x.val);
    let best = null;
    for (const opt of opts.slice(0, 5)) {
      const trial = structuredClone({ chains: layout.chains, sides: layout.sides });
      const res = tryStation(trial, inv, o, rng, opt);
      if (!res.tracks) continue;
      const dist = pt ? Math.hypot(res.center.x - pt.x, res.center.y - pt.y) : 0;
      const sc = res.tracks - dist / 800 + 0.4 * Math.min(res.usable / 600, 1);
      if (!best || sc > best.sc) best = { sc, res, trial };
    }
    if (!best) return { tracks: 0, want };
    layout.chains = best.trial.chains; layout.sides = best.trial.sides;
    return best.res;
  }
  function tryStation(layout, inv, o, rng, opt) {
    const { d } = opt;
    const run = refreshRun(layout, { ...opt.run });
    const ch = layout.chains[run.ci];
    const origArts = run.arts.slice();
    const rest = removeArts(run.arts, Array(d).fill(['24188', '24188', '24172', '24172']).flat());
    let spare = spareNow(layout, inv);
    const sp = { ...spare }; sp['24188'] += 2 * d;
    const X = [], other = [];
    shuffle(rng, rest).sort((a, b) => BY_ART[b].len - BY_ART[a].len);
    for (const a of rest) { if (sp[a] >= d && lenOf(X) < 1200) { X.push(a); sp[a] -= d; } else other.push(a); }
    const pre = [], post = [];
    for (let i = 0; i < d; i++) { pre.push('24188', '24172'); post.unshift('24172', '24188'); }
    const pattern = [...pre, ...X, ...post];
    const a0 = run.a, h = a0.h * D2R;
    let bestCut = 0, bestD = Infinity;
    for (let cut = 0; cut <= other.length; cut++) {
      const s = lenOf(other.slice(0, cut)) + lenOf(pattern) / 2;
      const c = { x: a0.x + Math.cos(h) * s, y: a0.y + Math.sin(h) * s };
      const dd = o.point ? Math.hypot(c.x - o.point.x, c.y - o.point.y) : Math.abs(cut - other.length / 2);
      if (dd < bestD) { bestD = dd; bestCut = cut; }
    }
    reorderRun(layout, run, [...other.slice(0, bestCut), ...pattern, ...other.slice(bestCut)]);
    const base0 = run.idx[bestCut], pl = pattern.length;
    const tracks = [{
      off: 0, pairs: new Set(Array.from({ length: d }, (_, i) => i + 1)),
      entry: p => ch.pieces[base0 + 2 * (p - 1)], exit: p => ch.pieces[base0 + pl - 1 - 2 * (p - 1)],
    }];
    const usedOff = new Set([0]);
    let built = 0;
    const s0 = ch.pieces[base0].start, e0 = ch.pieces[base0 + pl - 1].end;
    const center = { x: (s0.x + e0.x) / 2, y: (s0.y + e0.y) / 2 };
    let toPoint = 1;
    if (o.point) toPoint = Math.cos(h) * (o.point.y - center.y) - Math.sin(h) * (o.point.x - center.x) >= 0 ? 1 : -1;
    for (let p = 1; p <= d; p++) {
      const cands = [];
      for (const t of tracks) if (t.pairs.has(p)) for (const s of [toPoint, -toPoint]) if (!usedOff.has(t.off + s)) cands.push({ t, s });
      cands.sort((x, y) => Math.abs(x.t.off + x.s) - Math.abs(y.t.off + y.s) || (x.s === toPoint ? -1 : 1));
      for (const { t, s } of cands) {
        const e = t.entry(p), x = t.exit(p);
        const inner = pattern.slice(2 * p, pl - 2 * p);
        spare = spareNow(layout, inv);
        const swE = handFor(s), swX = handFor(-s);
        const need = countOf([...inner, '24224', '24224', swE, swX]);
        const sp2 = { ...spare }; sp2['24188'] += 2;
        if (!Object.keys(need).every(a => sp2[a] >= need[a])) continue;
        const segs = [
          { art: swE, geo: arcG(s), near: true, virtual: true },
          { art: '24224', geo: arcG(-s), near: true },
          ...inner.map(linePiece),
          { art: '24224', geo: arcG(-s), near: true },
          { art: swX, geo: arcG(s), near: true, virtual: true },
        ];
        const side = buildSide(e.start, segs);
        if (!sideOk(side.pts, layout, [e.start, x.end], o)) continue;
        e.art = swE; e.branch = { dir: s, from: 'start' };
        x.art = swX; x.branch = { dir: -s, from: 'end' };
        layout.sides.push({ type: 'station', pieces: side.pieces, pts: side.pts });
        const sps = side.pieces.slice(2, 2 + inner.length), il = inner.length;
        tracks.push({
          off: t.off + s, pairs: new Set(Array.from({ length: d - p }, (_, i) => p + 1 + i)),
          entry: q => sps[2 * (q - p - 1)], exit: q => sps[il - 1 - 2 * (q - p - 1)],
        });
        usedOff.add(t.off + s); built++;
        break;
      }
    }
    if (!built) { reorderRun(layout, run, origArts); return { tracks: 0, want: o.stationTracks }; }
    const offs = [...usedOff];
    const mid = (Math.min(...offs) + Math.max(...offs)) / 2 * TRACK_SPACING;
    return {
      tracks: built, want: o.stationTracks, length: lenOf(pattern), usable: lenOf(X),
      center: { x: center.x - Math.sin(h) * mid, y: center.y + Math.cos(h) * mid },
    };
  }

  // ---------- Vendeforbindelse: diagonal mellem to modsatrettede strækninger ----------
  function arcOptions(spare) {
    const opts = [{ arts: [], ang: 0 }];
    const six = spare['24206'] >= 2;
    for (const r of RADII) for (let k = 0; k <= 2; k++) for (const s6 of [false, true]) {
      if (!k && !s6) continue;
      if (s6 && !six) continue;
      if (k && spare[ART30[r]] < 2 * k) continue;
      if (!k && r !== RADII[0]) continue;
      const arts = [...(s6 ? ['24206'] : []), ...Array(k).fill(ART30[r])];
      opts.push({ arts, ang: arts.reduce((a, x) => a + BY_ART[x].ang, 0) });
    }
    return opts.filter(x => SW_ANG + x.ang <= 90.01);
  }
  function addCutoff(layout, inv, o, rng) {
    const pairs = shuffle(rng, runPairs(layout, ch => ch.eligible).filter(p => p.anti && Math.abs(p.off) > 250));
    for (const pr of pairs) {
      const T1 = refreshRun(layout, pr.A), T2 = refreshRun(layout, pr.B);
      if (!T2.free) continue;
      const u = unit(T1.h), sigma = Math.sign(pr.off), D = Math.abs(pr.off);
      const ch1 = layout.chains[T1.ci];
      const spare = spareNow(layout, inv);
      for (const ao of shuffle(rng, arcOptions(spare))) {
        const phi = SW_ANG + ao.ang;
        const sp = { ...spare }; ao.arts.forEach(a => sp[a] -= 2);
        // diagonal i lokalt system: gren, buer, L, buer omvendt, gren
        const geos = L => [arcG(sigma), ...arcPieces(ao.arts, sigma).map(p => p.geo), lineG(L),
          ...arcPieces(ao.arts.slice().reverse(), -sigma).map(p => p.geo), arcG(-sigma)];
        const e0 = walkAll({ x: 0, y: 0, h: 0 }, geos(0).filter(g => g.kind !== 'line' || g.len > 0));
        const L = (D - Math.abs(e0.y)) / Math.sin(phi * D2R);
        if (L < -0.5) continue;
        const lines = findStraights(sp, L, 1.0 / Math.max(0.4, Math.sin(phi * D2R)), 6);
        if (!lines) continue;
        const Lr = lenOf(lines);
        const e = walkAll({ x: 0, y: 0, h: 0 }, geos(Lr).filter(g => g.kind !== 'line' || g.len > 0));
        for (const i of shuffle(rng, T1.idx.slice())) {
          if (!switchable(ch1, i)) continue;
          const p1 = ch1.pieces[i];
          const x1 = axis(T1.a, u, p1.start);
          const X2 = x1 + e.x;                         // tungen på T2 (krop mod −u)
          const a2 = axis(T1.a, u, T2.a);
          const pl = placeOne(T2.arts, a2 - X2, 1.5);  // T2 kører mod −u: stykket starter ved X2
          if (!pl) continue;
          const save = T2.arts.slice();
          reorderRun(layout, T2, pl.order);
          const ch2 = layout.chains[T2.ci], i2 = T2.idx[pl.index], p2 = ch2.pieces[i2];
          const dir2 = Math.sign(cross(unit(p2.start.h), { x: p1.start.x - p2.start.x, y: p1.start.y - p2.start.y }));
          const h1 = handFor(sigma), h2 = handFor(dir2);
          const need = countOf([h1, h2, ...ao.arts, ...ao.arts, ...lines]);
          if (!switchable(ch2, i2) || !Object.keys(need).every(a => spare[a] >= need[a])) { reorderRun(layout, T2, save); continue; }
          const segs = [
            { art: h1, geo: arcG(sigma), near: true, virtual: true },
            ...arcPieces(ao.arts, sigma).map(p => ({ ...p, near: true })),
            ...lines.map(linePiece),
            ...arcPieces(ao.arts.slice().reverse(), -sigma).map(p => ({ ...p, near: true })),
            { art: h2, geo: arcG(-sigma), near: true, virtual: true },
          ];
          const side = buildSide(p1.start, segs);
          if (Math.hypot(side.end.x - p2.start.x, side.end.y - p2.start.y) > 3 || !sideOk(side.pts, layout, [p1.start, p2.start], o)) {
            reorderRun(layout, T2, save); continue;
          }
          p1.art = h1; p1.branch = { dir: sigma, from: 'start' };
          p2.art = h2; p2.branch = { dir: dir2, from: 'start' };
          layout.sides.push({ type: 'cutoff', pieces: side.pieces, pts: side.pts });
          return 1;
        }
      }
    }
    return 0;
  }

  // ---------- Trekantspor (vendetrekant) med stikspor ----------
  function addWye(layout, inv, o, rng) {
    const runs = shuffle(rng, collectRuns(layout).filter(r => r.free && r.arts.filter(a => a === '24188').length >= 2));
    for (const r of runs) {
      for (const sigma of shuffle(rng, [1, -1])) for (const cfg of shuffle(rng, ['C1', 'C2'])) {
        const res = tryWye(layout, inv, o, rng, r, sigma, cfg);
        if (res) return 1;
      }
    }
    return 0;
  }
  function tryWye(layout, inv, o, rng, run, sigma, cfg) {
    const spare = spareNow(layout, inv);
    if (bufLeft(spare) < 1) return false;
    const bA = bufArt(spare);
    // vinkler: C1 – ben A ind i C's lige spor (90°), ben B ind i C's gren; C2 omvendt
    const angA = cfg === 'C1' ? 90 - SW_ANG : 90 - 2 * SW_ANG;
    const angB = cfg === 'C1' ? 90 - 2 * SW_ANG : 90 - SW_ANG;
    const sp = { ...spare };
    const arcsA = findArcCombo(sp, angA); if (!arcsA) return false;
    arcsA.forEach(a => sp[a]--);
    const arcsB = findArcCombo(sp, angB); if (!arcsB) return false;
    arcsB.forEach(a => sp[a]--);
    // lokalt: A's tunge i (0,0) retning 0; B's tunge i (xB,0) retning 180; benene går mod sigma
    const legAend0 = walkAll({ x: 0, y: 0, h: 0 }, [arcG(sigma), ...arcPieces(arcsA, sigma).map(p => p.geo)]);
    const legBend0 = walkAll({ x: 0, y: 0, h: 180 }, [arcG(-sigma), ...arcPieces(arcsB, -sigma).map(p => p.geo)]);
    const up = 90 * sigma, down = up + 180;
    const dirC = Math.sign(cross(unit(down), { x: cfg === 'C1' ? 1 : -1, y: 0 }));
    const Pc0 = { x: 0, y: 0, h: down };
    const dM = walkGeo(Pc0, lineG(188.3)).end, dB = walkGeo(Pc0, arcG(dirC)).end;
    const [toA, toB] = cfg === 'C1' ? [dM, dB] : [dB, dM];
    const phiB = legBend0.h;
    const sB = Math.sin(phiB * D2R);
    const vCombos = C.straightCombos(sp, 3);
    for (const vA of vCombos.slice(0, 80)) {
      const sp2 = { ...sp }; vA.arts.forEach(a => sp2[a]--);
      if (vA.arts.some(a => sp2[a] < 0)) continue;
      const hA = legAend0.h * D2R;
      const aEnd = { x: legAend0.x + Math.cos(hA) * vA.sum, y: legAend0.y + Math.sin(hA) * vA.sum };
      const Pc = { x: aEnd.x - toA.x, y: aEnd.y - toA.y };
      const E = { x: Pc.x + toB.x, y: Pc.y + toB.y };
      const rB = (E.y - legBend0.y) / sB;
      if (rB < -0.5) continue;
      const rArts = findStraights(sp2, rB, 1.0 / Math.max(0.3, Math.abs(sB)), 4);
      if (!rArts) continue;
      const rLen = lenOf(rArts);
      const xB = E.x - legBend0.x - Math.cos(phiB * D2R) * rLen;
      const gap = xB - 2 * 188.3;
      if (gap < -1) continue;
      const sp3 = { ...sp2 }; rArts.forEach(a => sp3[a]--);
      const hands = [handFor(sigma), handFor(-sigma), handFor(dirC)];
      const tailOpts = [['24188', '24188'], ['24188'], ['24172'], ['24094'], []].filter(t => hasArts(sp3, t));
      const needBase = countOf(hands);
      if (!Object.keys(needBase).every(a => spare[a] >= needBase[a] + (a === '24188' ? 0 : 0))) continue;
      const placements = placeTwo(run.arts, gap, 1.5);
      for (const pl of shuffle(rng, placements).slice(0, 12)) {
        const save = run.arts.slice();
        reorderRun(layout, run, pl.order);
        const ch = layout.chains[run.ci];
        const pA = ch.pieces[run.idx[pl.iA]], pB = ch.pieces[run.idx[pl.iB]];
        const sA = pA.start, sBst = { ...pB.end, h: pB.end.h + 180 };
        const legA = buildSide(sA, [
          { art: hands[0], geo: arcG(sigma), near: true, virtual: true },
          ...arcPieces(arcsA, sigma).map(p => ({ ...p, near: true })),
          ...vA.arts.map(a => ({ ...linePiece(a), near: true })),
        ]);
        const legB = buildSide(sBst, [
          { art: hands[1], geo: arcG(-sigma), near: true, virtual: true },
          ...arcPieces(arcsB, -sigma).map(p => ({ ...p, near: true })),
          ...rArts.map(a => ({ ...linePiece(a), near: true })),
        ]);
        // C's tunge i verdenskoordinater: fra ben A's ende
        const wh = run.h * D2R, rot = v => ({ x: v.x * Math.cos(wh) - v.y * Math.sin(wh), y: v.x * Math.sin(wh) + v.y * Math.cos(wh) });
        const tA = rot(toA), tB = rot(toB);
        const pcW = { x: legA.end.x - tA.x, y: legA.end.y - tA.y, h: run.h + down };
        const eW = { x: pcW.x + tB.x, y: pcW.y + tB.y };
        if (Math.hypot(eW.x - legB.end.x, eW.y - legB.end.y) > 3) { reorderRun(layout, run, save); continue; }
        const cSide = buildSide(pcW, [{ art: hands[2], geo: lineG(188.3), branch: { dir: dirC, from: 'start' } }]);
        const cBranch = walkGeo(pcW, arcG(dirC)).pts;
        let ok = false;
        for (const tail of tailOpts) {
          const tailSide = buildSide({ ...pcW, h: pcW.h + 180 }, [...tail.map(linePiece), { art: bA, geo: lineG(77.5), buffer: true }]);
          const sw = [sA, sBst, pcW];
          const legPts = [...legA.pts, ...legB.pts];
          const cPts = [...cSide.pts, ...cBranch.map(q => ({ x: q.x, y: q.y, near: true }))].map(q => ({ ...q, near: true }));
          const tailPts = tailSide.pts.map((q, k) => ({ ...q, near: k < 3 }));
          const need = countOf([...hands, ...arcsA, ...arcsB, ...vA.arts, ...rArts, ...tail, bA]);
          if (!Object.keys(need).every(a => spare[a] + (a === '24188' ? 2 : 0) >= need[a])) continue;
          if (!sideOk(legA.pts, layout, sw, o) || !sideOk(legB.pts, layout, sw, o, legA.pts.filter(q => Math.hypot(q.x - pcW.x, q.y - pcW.y) > 450)) ||
              !sideOk(tailPts, layout, sw, o, legPts.filter(q => Math.hypot(q.x - pcW.x, q.y - pcW.y) > 450)) ||
              !sideOk(cPts, layout, sw, o)) continue;
          pA.art = hands[0]; pA.branch = { dir: sigma, from: 'start' };
          pB.art = hands[1]; pB.branch = { dir: -sigma, from: 'end' };
          layout.sides.push({ type: 'wye', pieces: legA.pieces, pts: legA.pts });
          layout.sides.push({ type: 'wye', pieces: legB.pieces, pts: legB.pts });
          layout.sides.push({ type: 'wye', pieces: cSide.pieces, pts: [...cSide.pts, ...cBranch] });
          layout.sides.push({ type: 'wye', pieces: tailSide.pieces, pts: tailSide.pts });
          ok = true;
          break;
        }
        if (ok) return true;
        reorderRun(layout, run, save);
      }
    }
    return false;
  }

  // ---------- Vendesløjfe (ballon) på et stikspor fra hovedsporet ----------
  function addBalloonStub(layout, inv, o, rng) {
    const spare0 = spareNow(layout, inv);
    if (spare0['24224'] < 2 || spare0['24611'] + spare0['24612'] < 2) return 0;
    const specs = endLoopSpecs(spare0, BALLOON_GAP, 2);
    if (!specs.length) return 0;
    const cands = [];
    layout.chains.forEach(ch => { if (ch.eligible) ch.pieces.forEach((p, i) => { if (switchable(ch, i)) cands.push(p); }); });
    for (const p of shuffle(rng, cands).slice(0, 25)) {
      for (const [or, s] of shuffle(rng, [[1, 1], [1, -1], [-1, 1], [-1, -1]])) {
        const spare = spareNow(layout, inv);
        const dirB = or > 0 ? s : -s, art = handFor(dirB);
        if (spare[art] < 1) continue;
        const st = or > 0 ? p.start : { ...p.end, h: p.end.h + 180 };
        const sp = { ...spare }; sp[art]--;
        // stiksporet: parallelt (24224) eller drejet 30–90° væk fra hovedsporet, så ballonen
        // kan pege ind i et frit område (fx midt i en oval)
        const turns = [{ arts: ['24224'], dir: -dirB }];
        for (const r of RADII) for (let k = 1; k <= 3; k++) if (sp[ART30[r]] >= k) turns.push({ arts: Array(k).fill(ART30[r]), dir: dirB });
        if (sp['24206'] >= 1) for (const r of RADII) for (let k = 0; k <= 2; k++) if (sp[ART30[r]] >= k) turns.push({ arts: ['24206', ...Array(k).fill(ART30[r])], dir: dirB });
        const turn = turns[Math.floor(rng() * turns.length)];
        if (!hasArts(sp, turn.arts)) continue;
        turn.arts.forEach(a => sp[a]--);
        const stubLen = shuffle(rng, [[], ['24188'], ['24188', '24188'], ['24172'], ['24236']]).find(t => hasArts(sp, t)) || [];
        stubLen.forEach(a => sp[a]--);
        const stub = buildSide(st, [
          { art, geo: arcG(dirB), near: true, virtual: true },
          ...arcPieces(turn.arts, turn.dir).map(q => ({ ...q, near: true })),
          ...stubLen.map(linePiece),
        ]);
        if (!sideOk(stub.pts, layout, [st], o)) continue;
        for (let k = 0; k < 6; k++) {
          const spec = pickSpec(rng, specs);
          const hands = ['24611', '24612'].filter(h => sp[h] > 0);
          if (!hands.length) break;
          const inv2 = { ...sp };
          const b = balloonChain(spec, hands[Math.floor(rng() * hands.length)], inv2);
          if (!b) continue;
          b.start = stub.end; b.eligible = false; layoutChain(b);
          if (chainsCollide([b])) continue;
          const bpts = b.samples.map(q => ({ x: q.x, y: q.y, near: true }));
          if (!sideOk(bpts, layout, [stub.end], o, stub.pts.filter(q => Math.hypot(q.x - stub.end.x, q.y - stub.end.y) > 450))) continue;
          p.art = art; p.branch = { dir: dirB, from: or > 0 ? 'start' : 'end' };
          layout.sides.push({ type: 'stub', pieces: stub.pieces, pts: stub.pts });
          layout.chains.push(b);
          return 1;
        }
      }
    }
    return 0;
  }

  // ---------- Blindspor ----------
  /** relaxed: hvis 24224 eller prelbuk er brugt op, lægges blindsporet i 24,3° vinkel og/eller uden prelbuk. */
  function addSidings(layout, inv, o, rng, want, relaxed = false) {
    const cands = [];
    layout.chains.forEach(ch => { if (ch.eligible) ch.pieces.forEach((p, i) => { if (switchable(ch, i)) cands.push({ ch, i }); }); });
    let count = 0;
    for (const { ch, i } of shuffle(rng, cands)) {
      if (count >= want) break;
      if (!switchable(ch, i)) continue;
      const p = ch.pieces[i];
      const spare = spareNow(layout, inv);
      const has224 = spare['24224'] >= 1, hasBuf = bufLeft(spare) >= 1, bA = bufArt(spare);
      // blindspor uden prelbuk laves aldrig (relaxed tillader kun at 24224 mangler)
      if ((spare['24611'] < 1 && spare['24612'] < 1) || !hasBuf || (!relaxed && !has224)) break;
      for (const [or, s] of shuffle(rng, [[1, 1], [1, -1], [-1, 1], [-1, -1]])) {
        const dirB = or > 0 ? s : -s, art = handFor(dirB);
        if (spare[art] < 1) continue;
        const st = or > 0 ? p.start : { ...p.end, h: p.end.h + 180 };
        const extra = [], sp = { ...spare }; if (has224) sp['24224']--;
        const n = o.maximize ? 3 + Math.floor(rng() * 6) : 1 + Math.floor(rng() * 4);
        for (let k = 0; k < n; k++) {
          const c = STRAIGHTS.filter(q => sp[q.art] > 0 && q.len >= 94);
          if (!c.length) break;
          const q = c[Math.floor(rng() * c.length)]; sp[q.art]--; extra.push(q.art);
        }
        for (let m = extra.length; m >= (hasBuf ? 0 : 1) && !p.branch; m--) {
          const side = buildSide(st, [
            { art, geo: arcG(dirB), near: true, virtual: true },
            ...(has224 ? [{ art: '24224', geo: arcG(-dirB), near: true }] : []),
            ...extra.slice(0, m).map((a, k) => ({ ...linePiece(a), near: !has224 && k === 0 })),
            ...(hasBuf ? [{ art: bA, geo: lineG(77.5), buffer: true }] : []),
          ]);
          if (sideOk(side.pts, layout, [st], o)) {
            p.art = art; p.branch = { dir: dirB, from: or > 0 ? 'start' : 'end' };
            layout.sides.push({ type: 'blindspor', pieces: side.pieces, pts: side.pts, rough: !has224 || !hasBuf });
            count++;
          }
        }
        if (p.branch) break;
      }
    }
    return count;
  }

  // ---------- Trevejsskifte med et blindspor til hver side ----------
  function addThreeWay(layout, inv, o, rng, relaxed = false) {
    const cands = [];
    layout.chains.forEach(ch => { if (ch.eligible) ch.pieces.forEach((p, i) => { if (switchable(ch, i)) cands.push({ ch, i }); }); });
    for (const { ch, i } of shuffle(rng, cands)) {
      const spare = spareNow(layout, inv);
      if (spare['24630'] < 1 || bufLeft(spare) < 2 || (!relaxed && spare['24224'] < 2)) return 0;
      if (!switchable(ch, i)) continue;
      const p = ch.pieces[i];
      for (const or of shuffle(rng, [1, -1])) {
        const st = or > 0 ? p.start : { ...p.end, h: p.end.h + 180 };
        const sp = { ...spare };
        const sides = [];
        let rough = false;
        for (const s of [1, -1]) {
          const u224 = sp['24224'] > 0, bA = bufArt(sp), uBuf = !!bA;
          if (u224) sp['24224']--; if (uBuf) sp[bA]--;
          rough = rough || !u224 || !uBuf;
          const extra = [];
          const n = (uBuf ? 1 : 2) + Math.floor(rng() * 3);
          for (let k = 0; k < n; k++) {
            const c = STRAIGHTS.filter(q => sp[q.art] > 0 && q.len >= 94);
            if (!c.length) break;
            const q = c[Math.floor(rng() * c.length)]; sp[q.art]--; extra.push(q.art);
          }
          if (!uBuf && !extra.length) { sides.push(null); continue; }
          sides.push(buildSide(st, [
            { art: '24630', geo: arcG(s), near: true, virtual: true },
            ...(u224 ? [{ art: '24224', geo: arcG(-s), near: true }] : []),
            ...extra.map((a, k) => ({ ...linePiece(a), near: !u224 && k === 0 })),
            ...(uBuf ? [{ art: bA, geo: lineG(77.5), buffer: true }] : []),
          ]));
        }
        if (sides.includes(null) || !sideOk(sides[0].pts, layout, [st], o) || !sideOk(sides[1].pts, layout, [st], o, sides[0].pts.filter(q => Math.hypot(q.x - st.x, q.y - st.y) > 450))) continue;
        p.art = '24630';
        p.branch = { dir: 1, from: or > 0 ? 'start' : 'end' };
        p.branch2 = { dir: -1, from: or > 0 ? 'start' : 'end' };
        sides.forEach(sd => layout.sides.push({ type: 'blindspor', pieces: sd.pieces, pts: sd.pts, rough }));
        return 1;
      }
    }
    return 0;
  }

  // ---------- Blindspor fra buesporskifte (i en R1-kurve) ----------
  // Buesporskiftets indre spor er R1 30° = præcis en 24130. Det ydre spor er 77,5 mm lige + R1 30°:
  // Märklin-kataloget beskriver buesporskiftet som "zwei versetzte Kreisausschnitte von 30° im
  // Radius 1, das Stammgleis ist um 77,5 mm verlängert" (H0-katalog 2005, s. 344).
  // 24771/24772 er samme princip i R3: indre spor R3 515 mm 30° (= 24330), stamsporet forlænget
  // 64,3 mm, så ydersporet efter 90° ligger 64,3 mm parallelt (= R4). Märklins vejledning 24771/24772.
  const CSW = {
    '24130': { L: '24671', R: '24672', r: C.R1, off: 77.5, outer: '24230', rOut: C.R2 },
    '24330': { L: '24771', R: '24772', r: C.R3, off: 64.3, mc: 55, outer: '24430', rOut: C.R4 },
  };
  const C_OUTER = (dir, base = '24130') => [lineG(CSW[base].off), arcG(dir, 30, CSW[base].r)];
  const cswArt = (base, dir) => dir > 0 ? CSW[base].L : CSW[base].R;
  function addCurveSidings(layout, inv, o, rng, want, relaxed = false) {
    const cands = [];
    layout.chains.forEach(ch => {
      if (!ch.eligible) return;
      ch.pieces.forEach((p, i) => {
        if (CSW[p.art] && !p.virtual && !p.branch && ![ch.pieces[i - 1], ch.pieces[i + 1]].some(q => q && q.branch)) cands.push({ ch, i });
      });
    });
    let count = 0;
    for (const { ch, i } of shuffle(rng, cands)) {
      if (count >= want) break;
      const p = ch.pieces[i];
      if (p.branch || [ch.pieces[i - 1], ch.pieces[i + 1]].some(q => q && q.branch)) continue;
      const spare = spareNow(layout, inv);
      const hasBuf = bufLeft(spare) >= 1, bA = bufArt(spare);
      if (!hasBuf) break;
      const base = p.art, mc = CSW[base].mc;
      if (spare[CSW[base].L] + spare[CSW[base].R] < 1) continue;
      for (const or of shuffle(rng, [1, -1])) {
        const dir = or > 0 ? p.geo.dir : -p.geo.dir;          // drejning set fra tungen
        const art = cswArt(base, dir);
        if (spare[art] < 1) continue;
        const st = or > 0 ? p.start : { ...p.end, h: p.end.h + 180 };
        const sp = { ...spare };
        const extra = [];
        const n = 1 + Math.floor(rng() * 4);
        for (let k = 0; k < n; k++) {
          const c = STRAIGHTS.filter(q => sp[q.art] > 0 && q.len >= 94);
          if (!c.length) break;
          const q = c[Math.floor(rng() * c.length)]; sp[q.art]--; extra.push(q.art);
        }
        let ok = false;
        for (let m = extra.length; m >= (hasBuf ? 0 : 1) && !ok; m--) {
          const side = buildSide(st, [
            ...C_OUTER(dir, base).map(g => ({ art, geo: g, near: true, virtual: true, mc })),
            ...extra.slice(0, m).map((a, k) => ({ ...linePiece(a), near: k === 0, mc })),
            ...(hasBuf ? [{ art: bA, geo: lineG(77.5), buffer: true, mc }] : []),
          ]);
          if (!sideOk(side.pts, layout, [st], o)) continue;
          p.art = art; p.branch = { dir, from: or > 0 ? 'start' : 'end', geos: C_OUTER(dir, base) };
          layout.sides.push({ type: 'blindspor', pieces: side.pieces, pts: side.pts, rough: !hasBuf });
          count++; ok = true;
        }
        if (ok) break;
      }
    }
    return count;
  }

  /** Kollisionstjek hvor en del af en kæde (s0..s1) ignoreres – bruges når et nyt spor følger den. */
  function clearOfExcept(pts, layout, o, ci, s0, s1, swPts) {
    const m = o.margin;
    for (const p of pts) if (p.x < m || p.y < m || p.x > o.W - m || p.y > o.H - m) return false;
    const g = new C.Grid(C.MIN_CLEAR);
    // s0 > s1: området går hen over en cyklisk kædes start/slut
    const inside = q => s0 <= s1 ? q.s >= s0 - 30 && q.s <= s1 + 30 : q.s >= s0 - 30 || q.s <= s1 + 30;
    layout.chains.forEach((ch, k) => ch.samples.forEach(q => { if (k !== ci || !inside(q)) g.add(q); }));
    layout.sides.forEach(sd => sd.pts.forEach(q => g.add(q)));
    const d2 = C.MIN_CLEAR * C.MIN_CLEAR - 1;
    return !pts.some(p => g.near(p.x, p.y, q => {
      const dx = q.x - p.x, dy = q.y - p.y;
      if (dx * dx + dy * dy >= (p.mc ? p.mc * p.mc - 1 : d2)) return false;
      return !swPts.some(w => Math.hypot(q.x - w.x, q.y - w.y) < 450);
    }));
  }

  // ---------- Vigespor i kurve med to buesporskifter ----------
  // Med det ydre spor = 77,5 mm lige + R1 30° er ydersporet hovedsporet forskudt 77,5 mm langs
  // starttangenten. Når hovedsporet mellem de to buesporskifter drejer præcis 180°, ender det
  // ydre spor præcis ved det andet skifte – med samme stykker som hovedsporet imellem.
  function addCurvePassing(layout, inv, o, rng) {
    const cands = [];
    layout.chains.forEach((ch, ci) => {
      if (!ch.eligible) return;
      const P = ch.pieces;
      for (let i = 0; i < P.length; i++) {
        const pi = P[i];
        if (!CSW[pi.art] || pi.branch || pi.virtual || pi.xing) continue;
        let turn = 0;
        for (let j = i; j < P.length; j++) {
          const q = P[j];
          if (q.branch || q.virtual || q.xing) break;
          if (q.geo.kind === 'arc') turn += q.geo.dir * q.geo.ang;
          if (Math.abs(turn) > 180.01) break;
          if (j > i && Math.abs(Math.abs(turn) - 180) < 0.01 && q.art === pi.art && q.geo.dir === pi.geo.dir) { cands.push({ ci, i, j }); break; }
        }
      }
    });
    for (const { ci, i, j } of shuffle(rng, cands)) {
      const ch = layout.chains[ci], P = ch.pieces, pi = P[i], pj = P[j];
      if (pi.branch || pj.branch || [P[i - 1], P[j + 1]].some(q => q && q.branch)) continue;
      const mid = P.slice(i + 1, j);
      if (mid.some(q => q.branch)) continue;
      const d1 = pi.geo.dir, d2 = -pj.geo.dir, base = pi.art, mc = CSW[base].mc;
      const h1 = cswArt(base, d1), h2 = cswArt(base, d2);
      const spare = spareNow(layout, inv);
      const need = countOf([h1, h2, ...mid.map(q => q.art)]);
      if (!Object.keys(need).every(a => spare[a] >= need[a])) continue;
      const segs = [
        ...C_OUTER(d1, base).map(g => ({ art: h1, geo: g, virtual: true, mc })),
        ...mid.map(q => ({ art: q.art, geo: { ...q.geo }, mc })),
        ...C_OUTER(d2, base).reverse().map(g => ({ art: h2, geo: { ...g, dir: g.dir !== undefined ? -g.dir : undefined }, virtual: true, mc })),
      ];
      const side = buildSide(pi.start, segs);
      if (Math.hypot(side.end.x - pj.end.x, side.end.y - pj.end.y) > 2) continue;
      if (!clearOfExcept(side.pts, layout, o, ci, pi.s0, pj.s1, [pi.start, pj.end])) continue;
      pi.art = h1; pi.branch = { dir: d1, from: 'start', geos: C_OUTER(d1, base) };
      pj.art = h2; pj.branch = { dir: d2, from: 'end', geos: C_OUTER(d2, base) };
      layout.sides.push({ type: 'station', pieces: side.pieces, pts: side.pts, st: 1 });
      return 1;
    }
    return 0;
  }

  // ---------- Station med trevejsskifte som indgang ----------
  // Trevejsskiftet deler i tre spor. Hver side bliver et vigespor (genforenes med et
  // almindeligt sporskifte) eller et blindspor, alt efter hvad lageret rækker til.
  function addThreeWayStation(layout, inv, o, rng) {
    const spare0 = spareNow(layout, inv);
    if (spare0['24630'] < 1 || spare0['24224'] < 3) return 0;
    const runs = collectRuns(layout).filter(r => r.free && r.arts.filter(a => a === '24188').length >= 2 && r.arts.filter(a => a === '24172').length >= 2);
    const dist = r => o.point ? segDist(o.point, r.a, r.b) : 0;
    runs.sort((a, b) => dist(a) - dist(b));
    for (const r0 of runs.slice(0, 6)) {
      const variants = shuffle(rng, [[1, 'loop', 'loop'], [-1, 'loop', 'loop'], [1, 'loop', 'stub'], [-1, 'loop', 'stub']]);
      variants.sort((a, b) => (b[2] === 'loop') - (a[2] === 'loop'));
      for (const [s, kind1, kind2] of variants) {
        const run = refreshRun(layout, { ...r0 });
        const both = kind2 === 'loop';
        const n188 = run.arts.filter(a => a === '24188').length, n172 = run.arts.filter(a => a === '24172').length;
        if (both && (n188 < 3 || n172 < 3)) continue;
        const spare = spareNow(layout, inv);
        const hA = handFor(-s), hB = handFor(s);
        const bA = bufArt(spare) || '24977';
        const base = both ? ['24630', '24224', '24224', '24224', '24224', hA, hB] : ['24630', '24224', '24224', '24224', hA, bA];
        const sp = { ...spare }; sp['24188'] += both ? 3 : 2;
        if (!hasArts(sp, base)) continue;
        base.forEach(a => sp[a]--);
        const rest = removeArts(run.arts, both ? ['24188', '24188', '24188', '24172', '24172', '24172'] : ['24188', '24188', '24172', '24172']);
        const X = [], other = [];
        const copies = both ? 2 : 1;
        for (const a of shuffle(rng, rest).sort((p, q) => BY_ART[q].len - BY_ART[p].len)) {
          if (sp[a] >= copies && lenOf(X) < 1000) { X.push(a); sp[a] -= copies; } else other.push(a);
        }
        if (both && !hasArts(sp, ['24188', '24172'])) continue;
        if (both) { sp['24188']--; sp['24172']--; }
        const pattern = both ? ['24188', '24172', ...X, '24172', '24188', '24172', '24188'] : ['24188', '24172', ...X, '24172', '24188'];
        // læg mønstret så midten kommer nærmest punktet
        let bestCut = 0, bestD = Infinity;
        const h = run.h * D2R;
        for (let cut = 0; cut <= other.length; cut++) {
          const sc = lenOf(other.slice(0, cut)) + lenOf(pattern) / 2;
          const c = { x: run.a.x + Math.cos(h) * sc, y: run.a.y + Math.sin(h) * sc };
          const dd = o.point ? Math.hypot(c.x - o.point.x, c.y - o.point.y) : Math.abs(cut - other.length / 2);
          if (dd < bestD) { bestD = dd; bestCut = cut; }
        }
        const save = run.arts.slice();
        reorderRun(layout, run, [...other.slice(0, bestCut), ...pattern, ...other.slice(bestCut)]);
        const ch = layout.chains[run.ci], b0 = run.idx[bestCut];
        const S3 = ch.pieces[b0], SWa = ch.pieces[b0 + 3 + X.length], SWb = both ? ch.pieces[b0 + 5 + X.length] : null;
        const st = S3.start;
        const loopA = buildSide(st, [
          { art: '24630', geo: arcG(s), near: true, virtual: true },
          { art: '24224', geo: arcG(-s), near: true },
          ...X.map(linePiece),
          { art: '24224', geo: arcG(-s), near: true },
          { art: hA, geo: arcG(s), near: true, virtual: true },
        ]);
        let sideB;
        if (both) {
          sideB = buildSide(st, [
            { art: '24630', geo: arcG(-s), near: true, virtual: true },
            { art: '24224', geo: arcG(s), near: true },
            ...[...X, '24172', '24188'].map(linePiece),
            { art: '24224', geo: arcG(s), near: true },
            { art: hB, geo: arcG(-s), near: true, virtual: true },
          ]);
        } else {
          const stub = shuffle(rng, [['24188', '24188'], ['24188'], ['24172', '24188'], ['24172']]).find(t => hasArts(sp, t)) || [];
          sideB = buildSide(st, [
            { art: '24630', geo: arcG(-s), near: true, virtual: true },
            { art: '24224', geo: arcG(s), near: true },
            ...stub.map(linePiece),
            { art: bA, geo: lineG(77.5), buffer: true },
          ]);
        }
        const sw = [st, SWa.end, ...(SWb ? [SWb.end] : [])];
        const endOk = Math.hypot(loopA.end.x - SWa.end.x, loopA.end.y - SWa.end.y) < 3 && (!both || Math.hypot(sideB.end.x - SWb.end.x, sideB.end.y - SWb.end.y) < 3);
        if (!endOk || !sideOk(loopA.pts, layout, sw, o) || !sideOk(sideB.pts, layout, sw, o, loopA.pts.filter(q => Math.hypot(q.x - st.x, q.y - st.y) > 450))) {
          reorderRun(layout, run, save); continue;
        }
        S3.art = '24630'; S3.branch = { dir: s, from: 'start' }; S3.branch2 = { dir: -s, from: 'start' };
        SWa.art = hA; SWa.branch = { dir: -s, from: 'end' };
        if (SWb) { SWb.art = hB; SWb.branch = { dir: s, from: 'end' }; }
        layout.sides.push({ type: 'station', pieces: loopA.pieces, pts: loopA.pts, st: both ? 2 : 1 });
        layout.sides.push({ type: both ? 'station' : 'blindspor', pieces: sideB.pieces, pts: sideB.pts });
        return 1;
      }
    }
    return 0;
  }

  // ---------- Station med buesporskifte (stationsspor der begynder i kurven) ----------
  // Buesporskiftets ydre spor er hovedsporet forskudt 77,5 mm langs starttangenten. Efter præcis
  // 90° kurve ligger det derfor 77,5 mm parallelt med den efterfølgende lige strækning – et
  // stationsspor, der genforenes med et almindeligt sporskifte + 24224. Virker i begge retninger.
  function addCurveStation(layout, inv, o, rng) {
    const cands = [];
    layout.chains.forEach((ch, ci) => {
      if (!ch.eligible) return;
      const P = ch.pieces, n = P.length;
      for (let i = 0; i < n; i++) {
        const pi = P[i];
        if (pi.art !== '24130' || pi.branch || pi.xing || pi.virtual) continue;
        for (const dirn of ['F', 'B']) {
          let turn = 0;
          for (let k = i; dirn === 'F' ? k < n : k >= 0; k += dirn === 'F' ? 1 : -1) {
            const q = P[k];
            if (q.branch || q.virtual || q.xing || q.geo.kind !== 'arc') break;
            turn += q.geo.dir * q.geo.ang;
            if (Math.abs(turn) > 90.01) break;
            if (Math.abs(Math.abs(turn) - 90) < 0.01) {
              const nb = P[dirn === 'F' ? k + 1 : k - 1];
              if (nb && nb.run !== undefined && Math.sign(turn) === pi.geo.dir) cands.push({ ci, dirn, i, k: dirn === 'F' ? k + 1 : k - 1 });
              break;
            }
          }
        }
      }
    });
    for (const cd of shuffle(rng, cands)) {
      const ch = layout.chains[cd.ci], P = ch.pieces, pi = P[cd.i];
      if (pi.branch) continue;
      const runId = P[cd.k].run;
      const idx = P.map((q, j) => q.run === runId ? j : -1).filter(j => j >= 0);
      if (idx.some((j, t) => t && j !== idx[t - 1] + 1)) continue;          // strækningen skal være sammenhængende
      const run = refreshRun(layout, { ci: cd.ci, run: runId, idx });
      if (!run.free || !run.arts.includes('24188') || !run.arts.includes('24172')) continue;
      const d = pi.geo.dir, s = -d;                                          // sidesporet ligger på ydersiden
      const arcsBetween = cd.dirn === 'F' ? P.slice(cd.i + 1, cd.k) : P.slice(cd.k + 1, cd.i);
      const hC = cd.dirn === 'F' ? (d > 0 ? '24671' : '24672') : (-d > 0 ? '24671' : '24672');
      const hS = cd.dirn === 'F' ? handFor(-s) : handFor(s);
      const spare = spareNow(layout, inv);
      const sp = { ...spare };
      const base = [hC, hS, '24224', ...arcsBetween.map(q => q.art)];
      if (!hasArts(sp, base)) continue;
      base.forEach(a => sp[a]--);
      // stykker der kopieres ud på stationssporet (så langt som lageret rækker)
      const rest = removeArts(run.arts, ['24188', '24172']);
      const A = [], B = [];
      for (const a of shuffle(rng, rest)) { if (sp[a] > 0) { A.push(a); sp[a]--; } else B.push(a); }
      if (lenOf(A) < 188) continue;                                          // for kort til at være et stationsspor
      const order = cd.dirn === 'F' ? [...A, '24172', '24188', ...B] : [...B, '24188', '24172', ...A];
      const save = run.arts.slice();
      reorderRun(layout, run, order);
      const sw = cd.dirn === 'F' ? P[run.idx[A.length + 1]] : P[run.idx[B.length]];
      let side, endPt;
      if (cd.dirn === 'F') {
        side = buildSide(pi.start, [
          ...C_OUTER(d).map(g => ({ art: hC, geo: g, virtual: true })),
          ...arcsBetween.map(q => ({ art: q.art, geo: { ...q.geo } })),
          ...A.map(linePiece),
          { art: '24224', geo: arcG(-s), near: true },
          { art: hS, geo: arcG(s), near: true, virtual: true },
        ]);
        endPt = sw.end;
      } else {
        const d2 = -d;
        side = buildSide(sw.start, [
          { art: hS, geo: arcG(s), near: true, virtual: true },
          { art: '24224', geo: arcG(-s), near: true },
          ...A.map(linePiece),
          ...arcsBetween.map(q => ({ art: q.art, geo: { ...q.geo } })),
          ...C_OUTER(d2).reverse().map(g => ({ art: hC, geo: g.kind === 'arc' ? { ...g, dir: -g.dir } : g, virtual: true })),
        ]);
        endPt = pi.end;
      }
      const s0 = Math.min(pi.s0, sw.s0), s1 = Math.max(pi.s1, sw.s1);
      if (Math.hypot(side.end.x - endPt.x, side.end.y - endPt.y) > 3 ||
          !clearOfExcept(side.pts, layout, o, cd.ci, s0, s1, [pi.start, pi.end, sw.start, sw.end])) { reorderRun(layout, run, save); continue; }
      if (cd.dirn === 'F') {
        pi.art = hC; pi.branch = { dir: d, from: 'start', geos: C_OUTER(d) };
        sw.art = hS; sw.branch = { dir: -s, from: 'end' };
      } else {
        pi.art = hC; pi.branch = { dir: -d, from: 'end', geos: C_OUTER(-d) };
        sw.art = hS; sw.branch = { dir: s, from: 'start' };
      }
      layout.sides.push({ type: 'station', pieces: side.pieces, pts: side.pts, st: 1 });
      return 1;
    }
    return 0;
  }

  // ---------- Hjørnestation: buesporskifter fanger ét spor ud til 2–3 parallelle spor ----------
  // Märklins C-gleisplaner (Startup-brochuren s. 15): Buesporskiftet T1 i begyndelsen af et 90°-hjørne
  // (3 × 24130). Dets ydre ben (77,5 mm + R1 30°) fører til et andet buesporskifte T2. T2's indre ben +
  // 24130 giver et spor 77,5 mm uden for hovedsporet, T2's ydre ben + 24230 (R2) et spor 155 mm uden
  // for. Efter hjørnet ligger alle tre parallelt langs den lige strækning; i næste hjørne samles de
  // spejlvendt. Samme princip i R3 med 24771/24772 (64,3 mm, ydre spor i R4).
  /** Lige stykker fra lageret med samlet længde L ± tol (dybdesøgning, muterer inv ved succes). */
  function fitStraights(inv, L, tol) {
    const types = STRAIGHTS.filter(p => (inv[p.art] || 0) > 0).sort((a, b) => b.len - a.len);
    const used = {}, out = []; let nodes = 0, found = null;
    (function dfs(ti, sum) {
      if (found || ++nodes > 60000) return;
      if (Math.abs(sum - L) <= tol) { found = out.slice(); return; }
      if (sum > L + tol || out.length >= 18) return;
      for (let i = ti; i < types.length; i++) {
        const a = types[i].art;
        if ((used[a] || 0) >= inv[a]) continue;
        used[a] = (used[a] || 0) + 1; out.push(a);
        dfs(i, sum + types[i].len);
        out.pop(); used[a]--;
        if (found) return;
      }
    })(0, 0);
    if (found) found.forEach(a => inv[a]--);
    return found;
  }
  function addCornerFan(layout, inv, o, rng, maxTracks = 2) {
    const cands = [];
    layout.chains.forEach((ch, ci) => {
      if (!ch.eligible) return;
      const P = ch.pieces, n = P.length;
      const at = i => ch.cyclic ? P[(i % n + n) % n] : P[i];
      const runs = collectRuns(layout, c => c === ch).filter(r => r.free);
      for (const r of runs) {
        const i0 = r.idx[0], i1 = r.idx[r.idx.length - 1];
        const A = [at(i0 - 3), at(i0 - 2), at(i0 - 1)], B = [at(i1 + 1), at(i1 + 2), at(i1 + 3)];
        if ([...A, ...B].some(q => !q || q.branch || q.virtual || q.xing || !CSW[q.art])) continue;
        const base = A[0].art, d = A[0].geo.dir;
        if ([...A, ...B].some(q => q.art !== base || q.geo.dir !== d)) continue;
        // nabo-sporskifter er ikke tilladt – undtagen et buesporskifte tunge mod tunge (Märklins
        // figur: 24672 | 24671 i bunden af en 180°-kurve)
        const iA = P.indexOf(A[0]), iB = P.indexOf(B[2]);
        const prevA = at(iA - 1), nextA = at(iA + 1), prevB = at(iB - 1), nextB = at(iB + 1);
        const tt = (x, from) => x && x.branch && BY_ART[x.art].kind === 'cswitch' && x.branch.from === from;
        if ((prevA && prevA.branch && !tt(prevA, 'end')) || (nextA && nextA.branch) || (prevB && prevB.branch) || (nextB && nextB.branch && !tt(nextB, 'start'))) continue;
        cands.push({ ci, run: r, A, B, base, d });
      }
    });
    const dist = c => o.point ? segDist(o.point, c.run.a, c.run.b) : rng() * 1000;
    cands.sort((a, b) => dist(a) - dist(b));
    for (const cd of cands.slice(0, 8)) {
      const { A, B, base, d } = cd, cs = CSW[base], mc = cs.mc;
      const ch = layout.chains[cd.ci];
      const T1 = A[0], T1b = B[2];
      const h1 = cswArt(base, d), h1b = cswArt(base, -d);
      const outerArt = cs.outer;
      for (const tracks of (maxTracks >= 2 ? [2, 1] : [1])) {
        const spare = spareNow(layout, inv), sp = { ...spare };
        const need = tracks === 2 ? [h1, h1b, h1, h1b, base, base, outerArt, outerArt] : [h1, h1b, base, base, base, base];
        if (!hasArts(sp, need)) continue;
        need.forEach(a => sp[a]--);
        const arc = (dir, r = cs.r) => arcG(dir, 30, r);
        const outerIn = C_OUTER(d, base).map(g => ({ art: h1, geo: g, near: true, virtual: true, mc }));
        const outerOut = (art, dir) => C_OUTER(dir, base).reverse().map(g => ({ art, geo: g.kind === 'arc' ? { ...g, dir: -g.dir } : g, near: true, virtual: true, mc }));
        // spor B (77,5 mm ude): T1 ydre ben, T2 (indre ben), 24130, lige, 24130, T2' (indre ben), T1' ydre ben
        const tB = tracks === 2;
        const headB = [...outerIn, tB ? { art: h1, geo: arc(d), near: true, mc } : { art: base, geo: arc(d), near: true, mc }, { art: base, geo: arc(d), mc }];
        const tailB = (lines) => [...lines, { art: base, geo: arc(d), mc }, tB ? { art: h1b, geo: arc(d), near: true, mc } : { art: base, geo: arc(d), near: true, mc }, ...outerOut(h1b, -d)];
        const probe = buildSide(T1.start, [...headB, ...tailB([])]);
        // manglende lige længde langs strækningen
        // fortegn: målet skal ligge foran (langs strækningen), ellers er strækningen for kort
        const fwd = (pr, t) => (t.x - pr.end.x) * Math.cos(pr.end.h * D2R) + (t.y - pr.end.y) * Math.sin(pr.end.h * D2R);
        const gapB = Math.hypot(T1b.end.x - probe.end.x, T1b.end.y - probe.end.y);
        if (fwd(probe, T1b.end) < -1) continue;
        const invB = { ...sp };
        const linesB = C.matchRun(invB, gapB, cd.run.arts);
        if (!linesB) continue;
        const sideB = buildSide(T1.start, [...headB, ...tailB(linesB.map(a => ({ ...linePiece(a), mc })))]);
        if (Math.hypot(sideB.end.x - T1b.end.x, sideB.end.y - T1b.end.y) > 2) continue;
        const sw = [T1.start, T1b.end];
        if (!clearOfExcept(sideB.pts, layout, o, cd.ci, T1.s0, T1b.s1, sw)) continue;
        let sideC = null, T2 = null, T2b = null, invC = invB;
        if (tB) {
          T2 = sideB.pieces[outerIn.length]; T2b = sideB.pieces[sideB.pieces.length - outerIn.length - 1];
          const headC = [...C_OUTER(d, base).map(g => ({ art: h1, geo: g, near: true, virtual: true, mc })), { art: outerArt, geo: arc(d, cs.rOut), near: true, mc }];
          const tailC = lines => [...lines, { art: outerArt, geo: arc(d, cs.rOut), near: true, mc }, ...outerOut(h1b, -d)];
          const pr = buildSide(T2.start, [...headC, ...tailC([])]);
          const gapC = Math.hypot(T2b.end.x - pr.end.x, T2b.end.y - pr.end.y);
          if (fwd(pr, T2b.end) < -1) continue;
          invC = { ...invB };
          const linesC = gapC < 1 ? [] : fitStraights(invC, gapC, 1.2);
          if (!linesC) continue;
          sideC = buildSide(T2.start, [...headC, ...tailC(linesC.map(a => ({ ...linePiece(a), mc })))]);
          if (Math.hypot(sideC.end.x - T2b.end.x, sideC.end.y - T2b.end.y) > 2) continue;
          const swC = [T2.start, T2b.end, ...sw];
          const extraB = sideB.pts.filter(q => swC.every(w => Math.hypot(q.x - w.x, q.y - w.y) > 600));
          if (!clearOfExcept(sideC.pts, { chains: layout.chains, sides: layout.sides }, o, cd.ci, T1.s0, T1b.s1, swC) ||
              !sideOk(sideC.pts.map(q => ({ ...q, near: true })), { chains: [], sides: [] }, swC, o, extraB)) continue;
        }
        // ok – sæt sporskifterne
        T1.art = h1; T1.branch = { dir: d, from: 'start', geos: C_OUTER(d, base) };
        T1b.art = h1b; T1b.branch = { dir: -d, from: 'end', geos: C_OUTER(-d, base) };
        if (tB) {
          T2.branch = { dir: d, from: 'start', geos: C_OUTER(d, base) };
          T2b.branch = { dir: -d, from: 'end', geos: C_OUTER(-d, base) };
        }
        layout.sides.push({ type: 'station', pieces: sideB.pieces, pts: sideB.pts, st: tB ? 2 : 1 });
        if (sideC) layout.sides.push({ type: 'station', pieces: sideC.pieces, pts: sideC.pts });
        return 1;
      }
    }
    return 0;
  }

  // ---------- Vigespor med slanke sporskifter (64,3 mm sporafstand) ----------
  // Hovedspor: 24711/24712 + 24071 + 24229 (= 536,2 mm). Gren: R 1114,6 mm 12,1° + 24071 + modkurve
  // 24912 – så ligger sidesporet 64,3 mm parallelt (Märklin-kataloget: "Kombinationen von 536,2 mm
  // Länge", 24071 på begge ben). Sporskifterne er lagt ind som lige stykker af composeRun.
  function addSlimPassing(layout, inv, o, rng) {
    const n = (arts, a) => arts.filter(x => x === a).length;
    const runs = collectRuns(layout).filter(r => r.free && r.arts.includes('24711') && r.arts.includes('24712') && n(r.arts, '24071') >= 2 && n(r.arts, '24229') >= 2);
    const dist = r => o.point ? segDist(o.point, r.a, r.b) : rng() * 1000;
    runs.sort((a, b) => dist(a) - dist(b));
    const MC = 55;
    const sArc = d => arcG(d, SLIM_ANG, R9);
    for (const r0 of runs.slice(0, 6)) for (const s of shuffle(rng, [1, -1])) {
      const run = refreshRun(layout, { ...r0 });
      if (!run.free) continue;
      const SA = s > 0 ? '24711' : '24712', SB = s > 0 ? '24712' : '24711';
      const spare = spareNow(layout, inv), sp = { ...spare };
      if (sp['24912'] < 2 || sp['24071'] < 2) return 0;
      sp['24912'] -= 2; sp['24071'] -= 2;
      const rest = removeArts(run.arts, [SA, '24071', '24229', '24229', '24071', SB]);
      const X = [], other = [];
      for (const a of shuffle(rng, rest).sort((p, q) => BY_ART[q].len - BY_ART[p].len)) {
        if (BY_ART[a].kind === 'straight' && sp[a] > 0 && lenOf(X) < 1200) { X.push(a); sp[a]--; } else other.push(a);
      }
      const pattern = [SA, '24071', '24229', ...X, '24229', '24071', SB];
      const h = run.h * D2R;
      let bestCut = 0, bestD = Infinity;
      for (let cut = 0; cut <= other.length; cut++) {
        const sc = lenOf(other.slice(0, cut)) + lenOf(pattern) / 2;
        const c = { x: run.a.x + Math.cos(h) * sc, y: run.a.y + Math.sin(h) * sc };
        const dd = o.point ? Math.hypot(c.x - o.point.x, c.y - o.point.y) : Math.abs(cut - other.length / 2);
        if (dd < bestD) { bestD = dd; bestCut = cut; }
      }
      const save = run.arts.slice();
      reorderRun(layout, run, [...other.slice(0, bestCut), ...pattern, ...other.slice(bestCut)]);
      const ch = layout.chains[run.ci], b0 = run.idx[bestCut];
      const pA = ch.pieces[b0], pB = ch.pieces[b0 + pattern.length - 1];
      const side = buildSide(pA.start, [
        { art: SA, geo: sArc(s), near: true, virtual: true, mc: MC },
        { ...linePiece('24071'), near: true, mc: MC },
        { art: '24912', geo: sArc(-s), near: true, mc: MC },
        ...X.map(a => ({ ...linePiece(a), mc: MC })),
        { art: '24912', geo: sArc(-s), near: true, mc: MC },
        { ...linePiece('24071'), near: true, mc: MC },
        { art: SB, geo: sArc(s), near: true, virtual: true, mc: MC },
      ]);
      if (Math.hypot(side.end.x - pB.end.x, side.end.y - pB.end.y) > 3 || !sideOk(side.pts, layout, [pA.start, pB.end], o)) {
        reorderRun(layout, run, save); continue;
      }
      pA.branch = { dir: s, from: 'start', geos: [sArc(s)] };
      pB.branch = { dir: -s, from: 'end', geos: [sArc(-s)] };
      layout.sides.push({ type: 'station', pieces: side.pieces, pts: side.pts, st: 1 });
      return 1;
    }
    return 0;
  }

  // ---------- Ekstra vigespor på lige stræk ----------
  function addPassing(layout, inv, o, rng, want) {
    let count = 0;
    for (let k = 0; k < want; k++) {
      const opts = shuffle(rng, stationOptions(layout, inv, 1, null));
      let ok = false;
      for (const opt of opts.slice(0, 6)) {
        const r = tryStation(layout, inv, { ...o, point: null, stationTracks: 1 }, rng, opt);
        if (r.tracks) { ok = true; count++; break; }
      }
      if (!ok) break;
    }
    return count;
  }

  // ---------- Opfyldning: placér de resterende sporskifter ----------
  // links: sporforbindelser husker hvilke kæder de forbinder (bruges til at tjekke at ringe hænger sammen)
  const SWITCH_ARTS = ['24611', '24612', '24630', '24671', '24672', '24771', '24772', '24711', '24712', '24624', '24620', '24720'];
  // slanke sporskifter uden gren ligger kun som lige stykker i hovedsporet – de tæller som ubrugte
  const idleSlim = layout => layout.chains.reduce((a, ch) => a + ch.pieces.filter(p => (p.art === '24711' || p.art === '24712') && !p.branch).length, 0);
  const switchesLeft = (layout, inv) => { const sp = spareNow(layout, inv); return SWITCH_ARTS.reduce((a, x) => a + Math.max(0, sp[x]), 0) + idleSlim(layout); };
  function fillSwitches(layout, inv, o, rng) {
    const used = {};
    const add = (id, n) => { if (n) used[id] = (used[id] || 0) + n; };
    let prev = -1;
    for (let round = 0; round < 12; round++) {
      const left = switchesLeft(layout, inv);
      if (!left || (left === prev && round > 1)) break;
      prev = left;
      // først det der hverken kræver 24224 eller prelbuk
      // klassisk først: forbindelser, stationsspor og vigespor – blindspor kun som sidste udvej
      add('crossover', addCrossovers(layout, inv, o, rng, 4));
      for (let k = 0; k < 2; k++) { const n = addCornerFan(layout, inv, o, rng); if (!n) break; add('cfan', n); }
      for (let k = 0; k < 4; k++) { const n = addCurveStation(layout, inv, o, rng); if (!n) break; add('cstation', n); }
      for (let k = 0; k < 6; k++) { const n = addCurvePassing(layout, inv, o, rng); if (!n) break; add('cpassing', n); }
      add('tstation', addThreeWayStation(layout, inv, o, rng));
      for (let k = 0; k < 3; k++) { const n = addSlimPassing(layout, inv, o, rng); if (!n) break; add('spassing', n); }
      add('passing', addPassing(layout, inv, o, rng, 3));
      if (MK.router && (o.elements || {}).link !== 'off') add('link', MK.router.addLinks(layout, inv, o, rng, 2));
      if (round < 1) continue;
      add('threeway', addThreeWay(layout, inv, o, rng, true));
      add('csiding', addCurveSidings(layout, inv, o, rng, 8, true));
      add('siding', addSidings(layout, inv, o, rng, 10, true));
    }
    return used;
  }

  MK.elements = [
    { id: 'ring', name: 'Parallel ring (dobbeltspor)', desc: 'Ydre ring 77,5 mm uden for en lukket sløjfe (R1→R2, R2→R3). Forbindes altid med sporforbindelser, så alt hænger sammen.', stage: 'topology' },
    { id: 'crossover', name: 'Sporforbindelser', desc: 'To sporskifter mellem parallelle spor. To modsatrettede giver en dobbeltrettet ring; på et hundeben bliver de til vendeforbindelser.', apply: (l, i, o, r) => addCrossovers(l, i, o, r, 2), reverseOn: 'dogbone' },
    { id: 'cutoff', name: 'Vendeforbindelse (diagonal)', desc: 'Diagonalt spor tværs gennem en oval mellem to modsatrettede lige stræk – deler banen i to vendesløjfer.', apply: addCutoff, reverse: true },
    { id: 'wye', name: 'Trekantspor', desc: 'Vendetrekant med tre sporskifter og stikspor. Kræver typisk 3× 24206 (5,7°).', apply: addWye, reverse: true },
    { id: 'stub', name: 'Vendesløjfe på stikspor', desc: 'Ballonsløjfe for enden af et stikspor fra hovedsporet.', apply: addBalloonStub, reverse: true },
    { id: 'tstation', name: 'Station med trevejsskifte', desc: 'Trevejsskifte 24630 som indgang: vigespor på begge sider (4× 24224) eller vigespor + blindspor (3× 24224). Lægges nær stationspunktet.', apply: addThreeWayStation },
    { id: 'cfan', name: 'Hjørnestation med buesporskifter', desc: 'Märklins hjørnekombination: buesporskifte i starten af et 90°-hjørne (3× 24130) + et buesporskifte mere på det ydre ben – ét spor bliver til tre parallelle spor (77,5 og 155 mm ude, med 24130 og 24230), som samles igen spejlvendt i næste hjørne. Kan også give ét ekstra spor. I R3 med 24771/24772 (64,3 mm, ydre spor 24430).', apply: addCornerFan },
    { id: 'cstation', name: 'Station med buesporskifte', desc: 'Stationsspor der begynder i kurven: buesporskifte 24671/24672 i starten af en 90°-kurve, ydersporet fortsætter parallelt langs den lige strækning og genforenes med sporskifte + 24224.', apply: addCurveStation },
    { id: 'passing', name: 'Ekstra vigespor', desc: 'Vigespor på lige stræk (sporskifte venstre + højre og 2× 24224) – 360 mm-rasteret: sporskifte + 24172 på hovedsporet.', apply: (l, i, o, r) => addPassing(l, i, o, r, o.maximize ? 2 : 1) },
    { id: 'spassing', name: 'Vigespor med slanke sporskifter', desc: 'Slanke sporskifter 24711/24712 (12,1°) med 24071 + modkurve 24912 – sidesporet ligger 64,3 mm parallelt. Hovedsporet: sporskifte + 24071 + 24229 (536,2 mm). Kræver 2× 24912, 4× 24071 og 2× 24229.', apply: addSlimPassing },
    { id: 'cpassing', name: 'Vigespor i kurve', desc: 'To buesporskifter om en 180°-kurve med et ydre vigespor: 24671/24672 i R1 (77,5 mm uden for) eller 24771/24772 i R3 (64,3 mm uden for).', apply: addCurvePassing },
    { id: 'threeway', name: 'Trevejsskifte', desc: 'Trevejsskifte 24630 med et blindspor til hver side (kræver 2× 24224 og 2 prelbukke 24977/24978).', apply: addThreeWay },
    { id: 'csiding', name: 'Blindspor fra buesporskifte', desc: 'Buesporskifte med blindspor: 24671/24672 i en R1-kurve (ydre spor 77,5 mm lige + R1 30°) eller 24771/24772 i en R3-kurve (64,3 mm + R3 30°).', apply: (l, i, o, r) => addCurveSidings(l, i, o, r, 1) },
    { id: 'siding', name: 'Blindspor', desc: 'Sporskifte + 24224 + lige spor + prelbuk 24977/24978.', apply: (l, i, o, r) => addSidings(l, i, o, r, o.maximize ? 2 : 1) },
  ];
  MK.station = { addStation, stationOptions };
  MK.switches = { fillSwitches, switchesLeft, SWITCH_ARTS };
})(typeof self !== 'undefined' ? self : globalThis);
