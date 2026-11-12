/*
 * Kerne: Märklin C-skinne-katalog, geometri, lager, kollision og fælles byggeklodser.
 * Alle mål i millimeter, vinkler i grader. x mod højre, y opad, 0° = mod højre,
 * positive vinkler = venstresving (mod uret).
 *
 * En bane består af "kæder" (sammenhængende sporstrenge: hovedsløjfe, ring, linje,
 * vendesløjfe) og "sidespor" (stationsspor, blindspor, forbindelser) der grener fra dem.
 */
(function (root) {
  'use strict';
  const MK = root.MK = root.MK || {};

  const R1 = 360, R2 = 437.5, R3 = 515, R4 = 579.3, R5 = 643.6;
  const R9 = 1114.6;           // slanke sporskifters grenradius (og modkurven 24912)
  const SW_ANG = 24.28;        // sporskiftets afvigevinkel (Märklin angiver 24,3°)
  const SW_LEN = 188.3;        // sporskiftets længde (= 24188)
  const SLIM_ANG = 12.1;       // slanke sporskifter 24711/24712: weichenbogen 12,1°
  const SLIM_LEN = 236.1;      // slanke sporskifters længde (= 24236)
  const SLIM_SPACING = 64.3;   // sporafstand med slanke sporskifter (= R3→R4→R5)
  const TRACK_SPACING = 77.5;  // standard sporafstand for parallelle C-spor
  const MIN_CLEAR = 75;        // mindste afstand mellem sporenes midterlinjer
  const JUNCTION = 400;        // område omkring en sammenføjning hvor spor må mødes
  const D2R = Math.PI / 180;

  // Kilde: Märklin H0-katalog 2005, afsnittet om C-skinner (s. 330–347). Geometrien:
  //  · Strækningsraster 360 mm = sporskifte (188,3) + modkurvens længde (171,7).
  //  · Sporskifte + 24224 giver 77,5 mm parallel sporafstand (= R1→R2→R3).
  //  · Sporskifte + 24206 (5,7°) = 30° – grenen fortsætter i 30°-rasteret.
  //  · Buesporskifte: to forskudte R1 30°-buer; stamsporet er forlænget 77,5 mm.
  //  · Slanke sporskifter: 236,1 mm, gren R 1114,6 mm / 12,1°, sporafstand 64,3 mm (= R3→R4→R5);
  //    der skal et 24071 på begge ben; kombinationslængde 536,2 mm (236,1 + 70,8 + 229,3).
  //  · Krydsninger og dobbelt krydsningssporskifte har samme mål som sporskiftet (188,3 mm/24,3°)
  //    og kan sættes ind i stedet for hinanden.
  const CATALOG = [
    { art: '24360', kind: 'straight', len: 360,   name: 'Lige spor 360 mm' },
    { art: '24236', kind: 'straight', len: 236.1, name: 'Lige spor 236,1 mm' },
    { art: '24229', kind: 'straight', len: 229.3, name: 'Lige spor 229,3 mm' },
    { art: '24188', kind: 'straight', len: 188.3, name: 'Lige spor 188,3 mm (standard)' },
    { art: '24172', kind: 'straight', len: 171.7, name: 'Lige spor 171,7 mm (udligning til sporskifte)' },
    { art: '24094', kind: 'straight', len: 94.2,  name: 'Lige spor 94,2 mm' },
    { art: '24077', kind: 'straight', len: 77.5,  name: 'Lige spor 77,5 mm' },
    { art: '24071', kind: 'straight', len: 70.8,  name: 'Lige spor 70,8 mm' },
    { art: '24064', kind: 'straight', len: 64.3,  name: 'Lige spor 64,3 mm' },
    // funktionsspor med samme mål som lige spor
    { art: '24088', kind: 'straight', len: 188.3, func: true, name: 'Tilslutningsspor 188,3 mm' },
    { art: '24994', kind: 'straight', len: 94.2,  func: true, name: 'Kontaktspor (Schaltgleis) lige, 94,2 mm' },
    { art: '24997', kind: 'straight', len: 94.2,  func: true, name: 'Afkoblingsspor 94,2 mm' },
    { art: '24995', kind: 'straight', len: 94.2,  func: true, name: 'Kontaktspor (fra sæt 24995), 94,2 mm' },
    { art: '74920', kind: 'straight', len: 94.2,  func: true, name: 'Funktionsspor 74920, 94,2 mm' },
    { art: '74924', kind: 'straight', len: 94.2,  func: true, name: 'Jernbaneoverkørsel 74924, 94,2 mm' },
    { art: '24922', kind: 'straight', len: 180,   func: true, name: 'Overgangsspor til K-skinner, 180 mm' },
    { art: '24951', kind: 'straight', len: 180,   func: true, name: 'Overgangsspor til M-skinner, 180 mm' },
    { art: '20197', kind: 'straight', len: 188.3, name: 'Lige spor 188,3 mm (20197)' },
    { art: '24130', kind: 'curve', r: R1, ang: 30,   rn: 'R1', name: 'Kurve R1 360 mm, 30°' },
    { art: '20196', kind: 'curve', r: R1, ang: 30,   rn: 'R1', name: 'Kurve R1 360 mm, 30° (20196)' },
    { art: '24115', kind: 'curve', r: R1, ang: 15,   rn: 'R1', name: 'Kurve R1 360 mm, 15°' },
    { art: '24194', kind: 'curve', r: R1, ang: 15,   rn: 'R1', func: true, name: 'Kontaktspor i kurve R1 360 mm, 15°' },
    { art: '24107', kind: 'curve', r: R1, ang: 7.5,  rn: 'R1', name: 'Kurve R1 360 mm, 7,5°' },
    { art: '24230', kind: 'curve', r: R2, ang: 30,   rn: 'R2', name: 'Kurve R2 437,5 mm, 30°' },
    { art: '24215', kind: 'curve', r: R2, ang: 15,   rn: 'R2', name: 'Kurve R2 437,5 mm, 15°' },
    { art: '24294', kind: 'curve', r: R2, ang: 15,   rn: 'R2', func: true, name: 'Kontaktspor i kurve R2 437,5 mm, 15°' },
    { art: '24207', kind: 'curve', r: R2, ang: 7.5,  rn: 'R2', name: 'Kurve R2 437,5 mm, 7,5°' },
    { art: '24224', kind: 'curve', r: R2, ang: SW_ANG, rn: 'R2', special: true, name: 'Modkurve R2 437,5 mm, 24,3° (til sporskifte)' },
    { art: '24206', kind: 'curve', r: R2, ang: 30 - SW_ANG, rn: 'R2', special: true, name: 'Kurve R2 437,5 mm, 5,7° (supplerer sporskifte/24224 til 30°)' },
    { art: '24330', kind: 'curve', r: R3, ang: 30,   rn: 'R3', name: 'Kurve R3 515 mm, 30°' },
    { art: '24315', kind: 'curve', r: R3, ang: 15,   rn: 'R3', name: 'Kurve R3 515 mm, 15°' },
    { art: '24430', kind: 'curve', r: R4, ang: 30,   rn: 'R4', name: 'Kurve R4 579,3 mm, 30°' },
    { art: '24530', kind: 'curve', r: R5, ang: 30,   rn: 'R5', name: 'Kurve R5 643,6 mm, 30°' },
    { art: '24912', kind: 'curve', r: R9, ang: SLIM_ANG, rn: 'R9', special: true, name: 'Modkurve R9 1114,6 mm, 12,1° (til slanke sporskifter)' },
    { art: '24611', kind: 'switch', hand: 'L', len: SW_LEN, r: R2, ang: SW_ANG, name: 'Sporskifte venstre, 188,3 mm, R2 24,3°' },
    { art: '24612', kind: 'switch', hand: 'R', len: SW_LEN, r: R2, ang: SW_ANG, name: 'Sporskifte højre, 188,3 mm, R2 24,3°' },
    { art: '24630', kind: 'switch3', len: SW_LEN, r: R2, ang: SW_ANG, name: 'Trevejsskifte, 188,3 mm, 2× R2 24,3°' },
    { art: '24671', kind: 'cswitch', hand: 'L', r: R1, ang: 30, name: 'Buesporskifte venstre, R1 30° (ydre spor 77,5 mm forskudt)' },
    { art: '24672', kind: 'cswitch', hand: 'R', r: R1, ang: 30, name: 'Buesporskifte højre, R1 30° (ydre spor 77,5 mm forskudt)' },
    { art: '24771', kind: 'cswitch', hand: 'L', r: R3, ang: 30, off: 64.3, name: 'Buesporskifte venstre, R3 30° (ydre spor 64,3 mm forskudt)' },
    { art: '24772', kind: 'cswitch', hand: 'R', r: R3, ang: 30, off: 64.3, name: 'Buesporskifte højre, R3 30° (ydre spor 64,3 mm forskudt)' },
    { art: '24711', kind: 'sswitch', hand: 'L', len: SLIM_LEN, r: R9, ang: SLIM_ANG, name: 'Slankt sporskifte venstre, 236,1 mm, R 1114,6 mm 12,1°' },
    { art: '24712', kind: 'sswitch', hand: 'R', len: SLIM_LEN, r: R9, ang: SLIM_ANG, name: 'Slankt sporskifte højre, 236,1 mm, R 1114,6 mm 12,1°' },
    { art: '24624', kind: 'dslip', len: SW_LEN, ang: SW_ANG, name: 'Dobbelt krydsningssporskifte, 188,3 mm, 24,3° (elektrisk)' },
    { art: '24620', kind: 'dslip', len: SW_LEN, ang: SW_ANG, name: 'Dobbelt krydsningssporskifte, 188,3 mm, 24,3° (håndbetjent)' },
    { art: '24720', kind: 'dslip', len: SLIM_LEN, ang: SLIM_ANG, name: 'Slankt dobbelt krydsningssporskifte, 236,1 mm, 12,1°' },
    { art: '24640', kind: 'crossing', len: SW_LEN, ang: SW_ANG, name: 'Krydsning 24,3°, 188,3 mm' },
    { art: '24649', kind: 'crossing', len: 103.3, ang: 2 * SW_ANG, name: 'Krydsning 48,6°, 103,3 mm' },
    { art: '24740', kind: 'crossing', len: SLIM_LEN, ang: SLIM_ANG, name: 'Slank krydsning 12,1°, 236,1 mm' },
    { art: '24977', kind: 'buffer', len: 77.5, name: 'Sporstopper (prelbuk), 77,5 mm' },
    { art: '24978', kind: 'buffer', len: 77.5, name: 'Sporstopper (prelbuk) med lys, 77,5 mm' },
  ];
  /** Prelbuk fra lageret: almindelig først, så den med lys. */
  const BUFFERS = ['24977', '24978'];
  const bufLeft = sp => BUFFERS.reduce((a, b) => a + Math.max(0, sp[b] || 0), 0);
  const bufArt = sp => BUFFERS.find(b => (sp[b] || 0) > 0) || null;
  const BY_ART = Object.fromEntries(CATALOG.map(p => [p.art, p]));
  const STRAIGHTS = CATALOG.filter(p => p.kind === 'straight');
  const CURVES = CATALOG.filter(p => p.kind === 'curve');
  const RADII = [R1, R2, R3, R4, R5];
  const RNAME = { 360: 'R1', 437.5: 'R2', 515: 'R3', 579.3: 'R4', 643.6: 'R5' };
  const ART30 = { 360: '24130', 437.5: '24230', 515: '24330', 579.3: '24430', 643.6: '24530' };

  // ---------- små hjælpere ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const pickW = (rng, items, w) => {
    const tot = w.reduce((a, b) => a + b, 0);
    let x = rng() * tot;
    for (let i = 0; i < items.length; i++) { x -= w[i]; if (x <= 0) return items[i]; }
    return items[items.length - 1];
  };
  const shuffle = (rng, a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const cnt = (inv, a) => inv[a] || 0;
  const lenOf = arts => arts.reduce((a, b) => a + BY_ART[b].len, 0);
  const geoLen = g => g.kind === 'line' ? g.len : g.kind === 'path' ? g.geos.reduce((a, x) => a + geoLen(x), 0) : g.r * g.ang * D2R;
  const arcG = (dir, ang = SW_ANG, r = R2) => ({ kind: 'arc', r, ang, dir });
  const lineG = len => ({ kind: 'line', len });
  const linePiece = a => ({ art: a, geo: lineG(BY_ART[a].len) });
  const arcPieces = (arts, dir) => arts.map(a => ({ art: a, geo: arcG(dir, BY_ART[a].ang, BY_ART[a].r) }));
  const handFor = dir => dir > 0 ? '24611' : '24612';
  const norm180 = a => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const unit = h => ({ x: Math.cos(h * D2R), y: Math.sin(h * D2R) });
  const removeArts = (arts, rm) => { const out = arts.slice(); rm.forEach(a => { const i = out.indexOf(a); if (i >= 0) out.splice(i, 1); }); return out; };
  const countOf = arts => { const c = {}; arts.forEach(a => c[a] = (c[a] || 0) + 1); return c; };

  // ---------- geometri ----------
  /**
   * Gå langs en geometri ({kind:'line',len} | {kind:'arc',r,ang,dir} | {kind:'path',geos}) fra tilstand st.
   * 'path' er en sammensat geometri – bruges når hovedsporet går gennem et buesporskiftes ydre ben
   * (77,5 mm lige + R1 30°).
   */
  function walkGeo(st, g, step = 25) {
    const pts = [];
    if (g.kind === 'path') {
      let cur = st;
      for (const sub of g.geos) { const w = walkGeo(cur, sub, step); pts.push(...(pts.length ? w.pts.slice(1) : w.pts)); cur = w.end; }
      return { pts, end: cur };
    }
    if (g.kind === 'line') {
      const n = Math.max(1, Math.ceil(g.len / step));
      const c = Math.cos(st.h * D2R), s = Math.sin(st.h * D2R);
      for (let i = 0; i <= n; i++) { const t = g.len * i / n; pts.push({ x: st.x + c * t, y: st.y + s * t, h: st.h }); }
    } else {
      const a = g.ang * D2R, n = Math.max(2, Math.ceil(g.r * a / step));
      const h0 = st.h * D2R, d = g.dir;
      const cx = st.x + g.r * Math.cos(h0 + d * Math.PI / 2), cy = st.y + g.r * Math.sin(h0 + d * Math.PI / 2);
      const phi0 = h0 - d * Math.PI / 2;
      for (let i = 0; i <= n; i++) {
        const t = a * i / n, phi = phi0 + d * t;
        pts.push({ x: cx + g.r * Math.cos(phi), y: cy + g.r * Math.sin(phi), h: st.h + d * g.ang * i / n });
      }
    }
    const e = pts[pts.length - 1];
    return { pts, end: { x: e.x, y: e.y, h: e.h } };
  }
  const walkAll = (st, geos) => { for (const g of geos) st = walkGeo(st, g).end; return st; };

  /** Placér alle stykker i en kæde ud fra kædens start. */
  function layoutChain(ch) {
    let st = ch.start, s = 0;
    const samples = [];
    for (const p of ch.pieces) {
      const w = walkGeo(st, p.geo);
      p.start = st; p.end = w.end; p.pts = w.pts; p.s0 = s;
      const len = geoLen(p.geo), n = w.pts.length;
      for (let i = (samples.length ? 1 : 0); i < n; i++) samples.push({ x: w.pts[i].x, y: w.pts[i].y, s: s + len * i / (n - 1), xg: !!p.xing });
      s += len; p.s1 = s; st = w.end;
    }
    ch.samples = samples; ch.length = s; ch.end = st;
    return ch;
  }

  class Grid {
    constructor(cell) { this.cell = cell; this.m = new Map(); }
    add(p) { const k = Math.floor(p.x / this.cell) + ',' + Math.floor(p.y / this.cell); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(p); }
    near(x, y, fn) {
      const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const a = this.m.get((cx + i) + ',' + (cy + j));
        if (a) for (const p of a) if (fn(p) === true) return true;
      }
      return false;
    }
  }

  /** Kollision mellem/inden for kæder (tæt kun tilladt langs sporet eller ved sammenføjninger). */
  function chainsCollide(chains) {
    const all = [];
    chains.forEach((ch, c) => {
      const L = ch.length;
      for (const p of ch.samples) all.push({ x: p.x, y: p.y, s: p.s, c, xg: p.xg, jd: ch.junc ? Math.min(p.s, L - p.s) : Infinity, i: all.length });
    });
    const g = new Grid(MIN_CLEAR); all.forEach(p => g.add(p));
    const d2 = MIN_CLEAR * MIN_CLEAR - 1;
    for (const p of all) {
      if (g.near(p.x, p.y, q => {
        if (q.i <= p.i) return false;
        const dx = q.x - p.x, dy = q.y - p.y;
        if (dx * dx + dy * dy >= d2) return false;
        if (p.xg && q.xg) return false;          // sporene krydser hinanden i en krydsning
        const jn = p.jd < JUNCTION && q.jd < JUNCTION;
        if (q.c === p.c) {
          const ch = chains[p.c];
          let sep = Math.abs(q.s - p.s); if (ch.cyclic) sep = Math.min(sep, ch.length - sep);
          return sep > 250 && !jn;
        }
        return !jn;
      })) return true;
    }
    return false;
  }

  function pointSegmentDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  function segmentsCross(a, b, c, d) {
    const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const ab = side(a, b, c), ab2 = side(a, b, d), cd = side(c, d, a), cd2 = side(c, d, b);
    return (ab === 0 && ab2 === 0)
      ? pointSegmentDistance(a, c, d) === 0 || pointSegmentDistance(b, c, d) === 0
      : ab * ab2 <= 0 && cd * cd2 <= 0;
  }
  function insidePolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  /** Tjekker spormidter mod brugerens polygoner, inklusive en lille sikkerhedsafstand. */
  function pointsClearAreas(points, areas, clearance = 35) {
    if (!areas || !areas.length || points.length < 1) return true;
    for (const area of areas) {
      if (!area || area.length < 3) continue;
      const edges = area.map((a, i) => [a, area[(i + 1) % area.length]]);
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (insidePolygon(p, area) || edges.some(([a, b]) => pointSegmentDistance(p, a, b) < clearance)) return false;
        if (i && edges.some(([a, b]) => {
          const from = points[i - 1];
          if (segmentsCross(from, p, a, b)) return true;
          return Math.min(pointSegmentDistance(from, a, b), pointSegmentDistance(p, a, b),
            pointSegmentDistance(a, from, p), pointSegmentDistance(b, from, p)) < clearance;
        })) return false;
      }
    }
    return true;
  }

  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  // ---------- lager ----------
  function capacity(inv, r) {
    let c = 0;
    for (const p of CURVES) if (p.r === r && !p.special) c += cnt(inv, p.art) * p.ang;
    if (r === R2) c += Math.min(cnt(inv, '24224'), cnt(inv, '24206')) * 30;
    return c;
  }
  function cap15(inv, r) {
    let c = 0;
    for (const p of CURVES) if (p.r === r && p.ang < 30 && !p.special) c += cnt(inv, p.art) * p.ang;
    return c;
  }
  const totalCurveDeg = inv => RADII.reduce((a, r) => a + capacity(inv, r), 0);

  /** Tag kurvestykker for en bue med radius r og vinkel ang (muterer inv ved succes). */
  function takeArc(inv, r, ang) {
    const used = {}, ps = [];
    const avail = a => cnt(inv, a) - (used[a] || 0);
    const take = a => { used[a] = (used[a] || 0) + 1; ps.push(a); };
    let rem = ang;
    const normal = CURVES.filter(p => p.r === r && !p.special).sort((a, b) => b.ang - a.ang);
    const big = normal.filter(p => p.ang === 30), small = normal.filter(p => p.ang < 30);
    for (const p of big) while (rem >= 30 - 1e-6 && avail(p.art) > 0) { take(p.art); rem -= 30; }
    if (r === R2) while (rem >= 30 - 1e-6 && avail('24224') > 0 && avail('24206') > 0) { take('24224'); take('24206'); rem -= 30; }
    for (const p of small) while (rem >= p.ang - 1e-6 && avail(p.art) > 0) { take(p.art); rem -= p.ang; }
    if (rem > 1e-6) return null;
    for (const a in used) inv[a] -= used[a];
    return ps;
  }
  function takeArts(inv, arts) {
    const need = countOf(arts);
    if (!Object.keys(need).every(a => cnt(inv, a) >= need[a])) return false;
    for (const a in need) inv[a] -= need[a];
    return true;
  }
  const hasArts = (inv, arts) => { const need = countOf(arts); return Object.keys(need).every(a => cnt(inv, a) >= need[a]); };

  /** Find kurvestykker (alle radier, også 24224/24206) der tilsammen giver vinklen ang. */
  function findArcCombo(inv, ang, maxPieces = 4) {
    const types = CURVES.filter(p => cnt(inv, p.art) > 0).sort((a, b) => b.ang - a.ang);
    const out = [], used = {}; let found = null;
    (function dfs(ti, sum) {
      if (found) return;
      if (Math.abs(sum - ang) < 0.02) { found = out.slice(); return; }
      if (sum > ang + 0.02 || out.length >= maxPieces) return;
      for (let i = ti; i < types.length; i++) {
        const a = types[i].art;
        if ((used[a] || 0) >= cnt(inv, a)) continue;
        used[a] = (used[a] || 0) + 1; out.push(a);
        dfs(i, sum + types[i].ang);
        out.pop(); used[a]--;
        if (found) return;
      }
    })(0, 0);
    return found;
  }

  function usageOf(layout) {
    const u = {};
    const add = p => { if (!p.virtual) u[p.art] = (u[p.art] || 0) + 1; };
    layout.chains.forEach(ch => ch.pieces.forEach(add));
    (layout.sides || []).forEach(sd => sd.pieces.forEach(add));
    return u;
  }
  function spareOf(inv, used) {
    const s = {};
    for (const p of CATALOG) s[p.art] = cnt(inv, p.art) - (used[p.art] || 0);
    return s;
  }
  const spareNow = (layout, inv) => spareOf(inv, usageOf(layout));

  /** Alle kombinationer (multimængder) af lige spor inden for et budget, sorteret efter længde. */
  function straightCombos(budget, maxPieces) {
    const types = STRAIGHTS.filter(p => (budget[p.art] || 0) > 0);
    const out = [], cur = [], used = {};
    (function rec(ti, sum) {
      out.push({ sum, arts: cur.slice() });
      if (cur.length >= maxPieces) return;
      for (let i = ti; i < types.length; i++) {
        const a = types[i].art;
        if ((used[a] || 0) >= budget[a]) continue;
        used[a] = (used[a] || 0) + 1; cur.push(a);
        rec(i, sum + types[i].len);
        cur.pop(); used[a]--;
      }
    })(0, 0);
    return out.sort((a, b) => a.sum - b.sum);
  }
  /** Find lige stykker fra lageret med længde target ± tol (færrest stykker foretrækkes). */
  function findStraights(inv, target, tol, maxPieces = 5) {
    if (target < -tol) return null;
    if (Math.abs(target) <= tol) return [];
    let best = null;
    for (const c of straightCombos(inv, maxPieces)) {
      const e = Math.abs(c.sum - target);
      if (e <= tol && (!best || c.arts.length < best.arts.length || (c.arts.length === best.arts.length && e < best.e))) best = { e, arts: c.arts };
      if (c.sum > target + tol) break;
    }
    return best ? best.arts : null;
  }

  // ---------- strækninger (runs) og omsortering ----------
  /** Lige strækninger (sammenhængende lige stykker med samme run-id). */
  function collectRuns(layout, filter = ch => ch.eligible) {
    const runs = [];
    layout.chains.forEach((ch, ci) => {
      if (!filter(ch)) return;
      let cur = null;
      ch.pieces.forEach((p, i) => {
        if (p.run === undefined) { cur = null; return; }
        if (!cur || cur.run !== p.run) runs.push(cur = { ci, run: p.run, idx: [] });
        cur.idx.push(i);
      });
    });
    runs.forEach(r => refreshRun(layout, r));
    return runs;
  }
  function refreshRun(layout, r) {
    const ch = layout.chains[r.ci];
    const ps = r.idx.map(i => ch.pieces[i]);
    r.arts = ps.map(p => p.art); r.len = lenOf(r.arts);
    r.a = ps[0].start; r.b = ps[ps.length - 1].end; r.h = r.a.h;
    r.free = ps.every(p => !p.branch);
    r.pieces = ps;
    return r;
  }
  function reorderRun(layout, r, arts) {
    const ch = layout.chains[r.ci];
    arts.forEach((a, k) => { const p = ch.pieces[r.idx[k]]; p.art = a; p.geo = lineG(BY_ART[a].len); });
    layoutChain(ch);
    return refreshRun(layout, r);
  }
  /** Alle delmængder (multimængder) af stykker med deres summer. */
  function subsetSums(arts, cap = 6000) {
    const c = countOf(arts), types = Object.keys(c);
    const out = [];
    (function rec(i, sum, pick) {
      if (out.length >= cap) return;
      if (i === types.length) { out.push({ sum, pick: pick.slice() }); return; }
      for (let k = 0; k <= c[types[i]]; k++) {
        rec(i + 1, sum + k * BY_ART[types[i]].len, pick);
        pick.push(types[i]);
      }
      for (let k = 0; k <= c[types[i]]; k++) pick.pop();
    })(0, 0, []);
    return out;
  }
  /** Omsortér så et 24188 starter i afstand ≈ off fra strækningens start. */
  function placeOne(arts, off, tol) {
    if (!arts.includes('24188')) return null;
    const others = removeArts(arts, ['24188']);
    let best = null;
    for (const o of subsetSums(others)) { const e = Math.abs(o.sum - off); if (e <= tol && (!best || e < best.e)) best = { e, o }; }
    if (!best) return null;
    return { order: [...best.o.pick, '24188', ...removeArts(others, best.o.pick)], index: best.o.pick.length };
  }
  /** Placering af to 24188 med mellemrum gap; returnerer flere muligheder for hvad der ligger før. */
  function placeTwo(arts, gap, tol) {
    if (arts.filter(a => a === '24188').length < 2) return [];
    const others = removeArts(arts, ['24188', '24188']);
    const res = [];
    for (const mid of subsetSums(others)) {
      if (Math.abs(mid.sum - gap) > tol) continue;
      const rest = removeArts(others, mid.pick);
      for (const pre of subsetSums(rest, 60)) {
        res.push({ order: [...pre.pick, '24188', ...mid.pick, '24188', ...removeArts(rest, pre.pick)], iA: pre.pick.length, iB: pre.pick.length + 1 + mid.pick.length, pre: pre.sum });
      }
      if (res.length > 40) break;
    }
    return res;
  }
  /** Stykker hvor et sporskifte kan indsættes (24188 uden nabo-sporskifter). */
  const switchable = (ch, i) => {
    const p = ch.pieces[i];
    return p && p.art === '24188' && !p.branch && p.run !== undefined && ![ch.pieces[i - 1], ch.pieces[i + 1]].some(q => q && q.branch);
  };

  // ---------- sidespor ----------
  const obstaclePts = layout => [...layout.chains.flatMap(ch => ch.samples), ...layout.sides.flatMap(sd => sd.pts)];

  /** Tjek at nye punkter ligger på pladen og fri af alt andet (undtagen tæt på sporskifterne swPts). */
  function sideOk(pts, layout, swPts, o, extra = []) {
    const m = o.margin;
    for (const p of pts) if (p.x < m || p.y < m || p.x > o.W - m || p.y > o.H - m) return false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 5; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
        if (dx * dx + dy * dy >= MIN_CLEAR * MIN_CLEAR) continue;
        if (swPts.some(w => Math.hypot(pts[i].x - w.x, pts[i].y - w.y) < 230 &&
          Math.hypot(pts[j].x - w.x, pts[j].y - w.y) < 230)) continue;
        return false;
      }
    }
    const g = new Grid(MIN_CLEAR);
    layout.chains.forEach(ch => ch.samples.forEach(q => g.add({ x: q.x, y: q.y, side: false })));
    layout.sides.forEach(sd => sd.pts.forEach(q => g.add({ x: q.x, y: q.y, side: true })));
    extra.forEach(q => g.add({ x: q.x, y: q.y, side: true }));
    const d2 = MIN_CLEAR * MIN_CLEAR - 1;
    for (const p of pts) {
      // p.mc: mindre frihøjde for spor der bevidst ligger tættere (slanke sporskifter, 64,3 mm)
      const pd2 = p.mc ? p.mc * p.mc - 1 : d2;
      if (g.near(p.x, p.y, q => {
        const dx = q.x - p.x, dy = q.y - p.y, dd = dx * dx + dy * dy;
        if (dd >= pd2) return false;
        if (p.near && swPts.some(w => Math.hypot(q.x - w.x, q.y - w.y) < 230)) {
          // tæt på sporskiftet må sporene gå tæt – men et andet sidespor må aldrig krydses
          return q.side && dd < 625 && !swPts.some(w => Math.hypot(q.x - w.x, q.y - w.y) < 150);
        }
        return true;
      })) return false;
    }
    return true;
  }
  function buildSide(start, segs) {
    let st = start; const pieces = [], pts = [];
    for (const sg of segs) {
      const w = walkGeo(st, sg.geo);
      pieces.push({ ...sg, start: st, end: w.end, pts: w.pts });
      w.pts.forEach(q => pts.push(sg.mc ? { x: q.x, y: q.y, near: !!sg.near, mc: sg.mc } : { x: q.x, y: q.y, near: !!sg.near }));
      st = w.end;
    }
    return { pieces, pts, end: st };
  }
  /** Tilstanden ved et sporskiftes tunge (spids), og retningen grenen peger. */
  const pointsState = p => p.branch.from === 'start' ? p.start : { ...p.end, h: p.end.h + 180 };
  /** Tegnepunkter for alle grene på et sporskifte (alm., trevejs, bue). */
  function branchPtsOf(p) {
    const out = [];
    for (const b of [p.branch, p.branch2]) {
      if (!b) continue;
      let st = b.from === 'start' ? p.start : { ...p.end, h: p.end.h + 180 };
      const pts = [];
      for (const g of b.geos || [arcG(b.dir)]) { const w = walkGeo(st, g); pts.push(...w.pts); st = w.end; }
      out.push(pts);
    }
    return out;
  }

  // ---------- vendekurver (bruges af hundeben, ballonsløjfer, vendesløjfe på stikspor) ----------
  /**
   * Halv vendekurve fra et ben til symmetriaksen: bue Ra θ væk fra det andet ben, [Ls],
   * buer (90°+θ) tilbage (evt. blandede radier), [Lv]. Lukning: slutpunktets afstand
   * til benet = halv benafstand (gap/2). copies = hvor mange halve kurver lageret skal dække.
   */
  function endLoopSpecs(inv, gap, copies, tol = 1) {
    const c = gap / 2;
    const budget = {}; STRAIGHTS.forEach(p => budget[p.art] = Math.floor(cnt(inv, p.art) / copies));
    const combos = straightCombos(budget, 4);
    const sums = combos.map(x => x.sum);
    const lower = v => { let lo = 0, hi = sums.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sums[m] < v) lo = m + 1; else hi = m; } return lo; };
    const cap = {}; RADII.forEach(r => cap[r] = capacity(inv, r));
    const specs = [], seen = new Set();
    for (const th of [30, 60]) for (const Ra of RADII) {
      const n = (90 + th) / 30;
      const arcsets = [];
      for (const rA of RADII) for (const rB of RADII) {
        if (rB < rA) continue;
        for (let k = (rA === rB ? n : 1); k <= n; k++) {
          const seq = [...Array(k).fill(rA), ...Array(n - k).fill(rB)];
          arcsets.push(seq);
          if (rA !== rB && k < n) arcsets.push(seq.slice().reverse());
        }
      }
      for (const seq of arcsets) {
        const need = {}; need[Ra] = copies * th; seq.forEach(r => need[r] = (need[r] || 0) + copies * 30);
        if (!Object.keys(need).every(r => cap[+r] >= need[r])) continue;
        let st = walkGeo({ x: 0, y: 0, h: 0 }, arcG(-1, th, Ra)).end;
        for (const r of seq) st = walkGeo(st, arcG(1, 30, r)).end;
        const y0 = st.y;
        for (const ls of combos) {
          const t = c - (y0 - ls.sum * Math.sin(th * D2R));
          if (t < -tol) continue;
          for (let i = lower(t - tol); i < sums.length && sums[i] <= t + tol; i++) {
            const lv = combos[i];
            const tot = countOf([...ls.arts, ...lv.arts]);
            const key = [th, Ra, seq.join(), ls.arts.join(), lv.arts.join()].join('|');
            if (!seen.has(key) && Object.keys(tot).every(a => tot[a] <= budget[a])) {
              seen.add(key); specs.push({ th, Ra, seq, ls: ls.arts, lv: lv.arts, size: ls.sum + lv.sum });
            }
          }
        }
      }
    }
    return specs;
  }
  const pickSpec = (rng, specs) => pickW(rng, specs, specs.map(x => 1 / (1 + x.size / 250) ** 2));

  /** Stykker til en hel vendekurve (to halvdele), m=+1: kurven bugter mod venstre. Muterer inv. */
  function endLoopPieces(spec, m, inv) {
    const halves = [];
    for (let i = 0; i < 2; i++) {
      const a = takeArc(inv, spec.Ra, spec.th); if (!a) return null;
      const b = [];
      for (const r of spec.seq) { const x = takeArc(inv, r, 30); if (!x) return null; b.push(x); }
      halves.push([a, b]);
    }
    if (!takeArts(inv, [...spec.ls, ...spec.ls, ...spec.lv, ...spec.lv])) return null;
    const lines = arts => arts.map(linePiece);
    return [
      ...arcPieces(halves[0][0], -m),
      ...lines(spec.ls),
      ...halves[0][1].flatMap(x => arcPieces(x, m)),
      ...lines(spec.lv),
      ...lines(spec.lv.slice().reverse()),
      ...halves[1][1].slice().reverse().flatMap(x => arcPieces(x, m)),
      ...lines(spec.ls.slice().reverse()),
      ...arcPieces(halves[1][0], -m),
    ];
  }
  /** Ballonsløjfe: sporskifte + 24172 / gren + 24224 som to parallelle ben, derefter vendekurve. */
  const BALLOON_GAP = walkGeo(walkGeo({ x: 0, y: 0, h: 0 }, arcG(1)).end, arcG(-1)).end.y;
  function balloonChain(spec, hand, inv) {
    const m = hand === '24611' ? 1 : -1;
    if (!takeArts(inv, [hand, '24172', '24224'])) return null;
    const loop = endLoopPieces(spec, m, inv); if (!loop) return null;
    return {
      kind: 'balloon', cyclic: true, junc: true,
      pieces: [
        { ...linePiece('24188'), art: hand, branch: { dir: m, from: 'start' } },
        linePiece('24172'),
        ...loop,
        { art: '24224', geo: arcG(m) },
        { art: hand, geo: arcG(-m), virtual: true },
      ],
    };
  }

  // ---------- planlægning af lige strækninger ----------
  function randomComposition(rng, total, parts) {
    const cuts = new Set();
    while (cuts.size < parts - 1) cuts.add(1 + Math.floor(rng() * (total - 1)));
    const c = [0, ...[...cuts].sort((a, b) => a - b), total];
    const out = [];
    for (let i = 1; i < c.length; i++) out.push(c[i] - c[i - 1]);
    return out;
  }
  function chooseRadius(rng, cap, c15, abs, opts) {
    const ok = r => cap[r] >= 2 * abs - 1e-6 && (abs % 30 === 0 || c15[r] >= 2 * (abs % 30));
    const cands = RADII.filter(ok);
    if (!cands.length) return null;
    return pickW(rng, cands, cands.map(r => opts.largeRadius ? r * r / 1e5 : 1));
  }
  /** Tilføj en bue til en plan; deler op over flere radier hvis nødvendigt. */
  function pushArc(slots, rng, cap, c15, a, opts) {
    const abs = Math.abs(a), dir = Math.sign(a);
    const r = chooseRadius(rng, cap, c15, abs, opts);
    if (r) {
      cap[r] -= 2 * abs; if (abs % 30) c15[r] -= 2 * (abs % 30);
      slots.push({ type: 'arc', r, ang: abs, dir });
      return true;
    }
    let rem = abs;
    while (rem > 1e-6) {
      const chunk = rem >= 30 ? 30 : rem;
      const r2 = chooseRadius(rng, cap, c15, chunk, opts);
      if (!r2) return false;
      cap[r2] -= 2 * chunk; if (chunk % 30) c15[r2] -= 2 * chunk;
      const last = slots[slots.length - 1];
      if (last && last.type === 'arc' && last.r === r2 && last.dir === dir) last.ang += chunk;
      else slots.push({ type: 'arc', r: r2, ang: chunk, dir });
      rem -= chunk;
    }
    return true;
  }
  const capsOf = inv => { const cap = {}, c15 = {}; RADII.forEach(r => { cap[r] = capacity(inv, r); c15[r] = cap15(inv, r); }); return { cap, c15 }; };

  function composeRun(inv, budget, target, opts, rng) {
    const ps = []; let L = 0;
    const use = a => { inv[a]--; budget[a]--; ps.push(a); L += BY_ART[a].len; };
    // stykker nok til en stationsstige / sporforbindelser (2d × 24188 + 2d × 24172)
    const d = opts.seedPairs ? 1 + Math.floor(rng() * opts.seedPairs) : 0;
    if (d && rng() < 0.55 && cnt(inv, '24188') >= 2 * d && cnt(inv, '24172') >= 2 * d) {
      for (let i = 0; i < d; i++) { use('24188'); use('24188'); use('24172'); use('24172'); }
    }
    // slanke sporskifter lægges ind som lige stykker (236,1 mm) sammen med 24071 + 24229, så de
    // senere kan blive til et vigespor med 64,3 mm sporafstand
    if (opts.slimSeed && rng() < 0.6 && cnt(inv, '24711') >= 1 && cnt(inv, '24712') >= 1 && cnt(inv, '24071') >= 2 && cnt(inv, '24229') >= 2 &&
        (budget['24071'] || 0) >= 2 && (budget['24229'] || 0) >= 2) {
      for (const a of ['24711', '24712']) { inv[a]--; ps.push(a); L += BY_ART[a].len; }
      use('24071'); use('24071'); use('24229'); use('24229');
    }
    for (let guard = 0; guard < 60; guard++) {
      const rem = target - L;
      const cands = STRAIGHTS.filter(p => cnt(inv, p.art) > 0 && (budget[p.art] || 0) > 0 && p.len <= rem + 40);
      if (!cands.length) break;
      use(pickW(rng, cands, cands.map(p => p.art === '24188' ? 3 : 1)).art);
    }
    return ps;
  }
  /** Find stykker med samme længde L (±0,6 mm); foretrækker præcis samme sammensætning. */
  function matchRun(inv, L, preferred) {
    if (L < 1) return [];
    if (preferred && preferred.length && takeArts(inv, preferred)) return preferred.slice();
    const types = STRAIGHTS.filter(p => cnt(inv, p.art) > 0);
    const used = {}, out = []; let nodes = 0, found = null;
    (function dfs(ti, sum) {
      if (found || ++nodes > 20000) return;
      if (Math.abs(sum - L) <= 0.6) { found = out.slice(); return; }
      if (sum > L + 0.6 || out.length >= 14) return;
      for (let i = ti; i < types.length; i++) {
        const a = types[i].art;
        if ((used[a] || 0) >= cnt(inv, a)) continue;
        used[a] = (used[a] || 0) + 1; out.push(a);
        dfs(i, sum + types[i].len);
        out.pop(); used[a]--;
        if (found) return;
      }
    })(0, 0);
    if (!found) return null;
    found.forEach(a => inv[a]--);
    return found;
  }
  /** Realisér en halv plan to gange (anden halvdel med samme længder). Muterer inv. */
  function realize(plan, inv, opts, rng, maxRun) {
    const budget = {}; STRAIGHTS.forEach(p => budget[p.art] = Math.floor(cnt(inv, p.art) / 2));
    const half1 = [];
    for (const sl of plan.slots) {
      if (sl.type === 'arc') {
        const ps = takeArc(inv, sl.r, sl.ang); if (!ps) return null;
        half1.push({ type: 'arc', r: sl.r, ang: sl.ang, dir: sl.dir, pieces: ps });
      } else {
        const target = rng() < 0.2 ? 0 : rng() * maxRun;
        const ps = composeRun(inv, budget, target, opts, rng);
        half1.push({ type: 'run', pieces: ps, len: lenOf(ps) });
      }
    }
    const half2 = [];
    for (const sl of half1) {
      if (sl.type === 'arc') {
        const ps = takeArc(inv, sl.r, sl.ang); if (!ps) return null;
        half2.push({ ...sl, pieces: ps });
      } else {
        const ps = matchRun(inv, sl.len, sl.pieces); if (!ps) return null;
        half2.push({ type: 'run', pieces: ps, len: sl.len });
      }
    }
    return [half1, half2];
  }
  let runCounter = 0;
  const newRunId = () => ++runCounter;
  function slotsToPieces(slots) {
    const pieces = [];
    for (const sl of slots) {
      if (sl.type === 'arc') pieces.push(...arcPieces(sl.pieces, sl.dir));
      else { const id = newRunId(); sl.pieces.forEach(a => pieces.push({ ...linePiece(a), run: id })); }
    }
    return pieces;
  }
  const sigOf = slots => slots.map(s => s.type === 'arc' ? `${RNAME[s.r]}${s.dir > 0 ? '+' : '-'}${s.ang}` : `L${Math.round(s.len / 20)}`).join('|');
  const rightOf = (st, d) => ({ x: st.x + d * Math.sin(st.h * D2R), y: st.y - d * Math.cos(st.h * D2R), h: st.h });

  MK.core = {
    R1, R2, R3, R4, R5, R9, SW_ANG, SW_LEN, SLIM_ANG, SLIM_LEN, SLIM_SPACING, BUFFERS, bufLeft, bufArt, TRACK_SPACING, MIN_CLEAR, JUNCTION, D2R,
    CATALOG, BY_ART, STRAIGHTS, CURVES, RADII, RNAME, ART30, BALLOON_GAP,
    mulberry32, pickW, shuffle, cnt, lenOf, geoLen, arcG, lineG, linePiece, arcPieces, handFor, norm180, cross, unit, removeArts, countOf,
    walkGeo, walkAll, layoutChain, Grid, chainsCollide, bbox, pointsClearAreas,
    capacity, cap15, totalCurveDeg, takeArc, takeArts, hasArts, findArcCombo, usageOf, spareOf, spareNow, straightCombos, findStraights,
    collectRuns, refreshRun, reorderRun, subsetSums, placeOne, placeTwo, switchable,
    obstaclePts, sideOk, buildSide, pointsState, branchPtsOf,
    endLoopSpecs, pickSpec, endLoopPieces, balloonChain,
    randomComposition, chooseRadius, pushArc, capsOf, composeRun, matchRun, realize, newRunId, slotsToPieces, sigOf, rightOf,
  };
})(typeof self !== 'undefined' ? self : globalThis);
