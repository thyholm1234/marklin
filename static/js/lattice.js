/*
 * Gitter: eksakt heltalsregning for C-sporets geometri.
 *
 * Alle retninger i C-sporet er multipla af 30°, og alle mål er hele tiendedele millimeter. Lad
 * ζ = e^(iπ/6). En position er et tal i Z[ζ], skrevet som fire heltal [a, b, c, d] = a + bζ + cζ² + dζ³
 * i enheden 0,1 mm (ζ⁴ = ζ² − 1, ζ⁶ = −1). En retning er et heltal k i 0..11 (k · 30°).
 * Så bliver "lukker banen" og "mødes de to ender" til sammenligning af heltal.
 *
 * Filen indeholder desuden en bredde-først-søgning (`bfs`) over skridt (lige stykker, 30°-buer,
 * S-kurver af 24224), som ruteløseren (router.js) og grundformen "Fri sløjfe" (topologies.js) bygger på.
 *
 * Koordinater i bfs: tilstandens position er [a,b,c,d] i søgningens eget system (start i origo, retning 0
 * = startstillingens retning); verdenspositionen i mm følges med ved siden af.
 */
(function (root) {
  'use strict';
  const MK = root.MK = root.MK || {};
  const C = MK.core;
  const { D2R } = C;
  const SQ3H = Math.sqrt(3) / 2;

  // ---------- tal ----------
  const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2], p[3] + q[3]];
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2], p[3] - q[3]];
  const neg = p => [-p[0], -p[1], -p[2], -p[3]];
  const mod12 = k => ((k % 12) + 12) % 12;
  const rot1 = p => [-p[3], p[0], p[1] + p[3], p[2]];
  /** Drej k · 30° mod uret. */
  function rot(p, k) { k = mod12(k); for (let i = 0; i < k; i++) p = rot1(p); return p; }
  /** Til millimeter. */
  const toXY = p => ({ x: (p[0] + p[1] * SQ3H + p[2] / 2) / 10, y: (p[1] / 2 + p[2] * SQ3H + p[3]) / 10 });
  const eq = (p, q) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2] && p[3] === q[3];
  /** Nøgle til Map-opslag (position + retning). */
  const key = (p, k) => p[0] + ',' + p[1] + ',' + p[2] + ',' + p[3] + ',' + mod12(k);
  /** Tal-nøgle (hurtig): to 32-bit-hasher sat sammen til et sikkert heltal. Kollisioner er så sjældne, at de ignoreres. */
  function hkey(a, b, c, d, k) {
    const h1 = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791) ^ Math.imul(d, 2654435761) ^ Math.imul(k + 1, 40503)) >>> 0;
    const h2 = (Math.imul(a + 7, 668265263) ^ Math.imul(b + 13, 374761393) ^ Math.imul(c + 29, 1274126177) ^ Math.imul(d + 31, 1103515245) ^ Math.imul(k + 5, 2246822519)) >>> 0;
    return h1 * 2097152 + (h2 & 0x1fffff);
  }
  /** Vinkel → (klasse, k): klassen er vinklen mod 30° i 0,1°, k tæller 30°-skridt fra klassens grundvinkel. */
  function headClass(h) {
    const m = ((h % 30) + 30) % 30;
    const cls = Math.round(m * 10) % 300;
    const base = cls / 10;
    return { cls, k: mod12(Math.round((h - base) / 30)) };
  }
  /**
   * Oversæt en stilling {x,y,h} (mm, grader) til gitteret med origo i `origin` (standard 0,0,0°).
   * Retningen skal være et helt antal 30° fra origoets (±0,05°), ellers null. Positionen afrundes til hele
   * 0,1 mm i origoets akser ([X,0,0,Y]) – eksakt hvis stillingen ligger sådan, ellers højst 0,07 mm fra.
   */
  function fromPose(pose, origin) {
    const o = origin || { x: 0, y: 0, h: 0 };
    const kf = (pose.h - o.h) / 30, k = Math.round(kf);
    if (Math.abs((kf - k) * 30) > 0.05) return null;
    const c = Math.cos(-o.h * D2R), s = Math.sin(-o.h * D2R), dx = pose.x - o.x, dy = pose.y - o.y;
    return { p: [Math.round((dx * c - dy * s) * 10), 0, 0, Math.round((dx * s + dy * c) * 10)], k: mod12(k) };
  }

  // ---------- skridt ----------
  const U = mm => Math.round(mm * 10);
  /** Lokal forskydning (start i origo, retning 0) af en bue af 30° med radius R (enheder 0,1 mm). */
  const arcLeft = R => [R, 0, -R, R], arcRight = R => [0, 0, R, -R];

  const N_LIST = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
  const ARC_M = [1, 2, 3, 4, 6];
  const R_ARC = [['R1', C.R1], ['R2', C.R2], ['R3', C.R3], ['R4', C.R4], ['R5', C.R5]];

  /**
   * Skridt og ressourcer ud fra et lager (`spare`). Returnerer
   *   { steps, res, capsFor(spare) }
   * hvor en ressource er en længdeklasse af lige stykker (varenumre med samme længde), buer pr. radius
   * eller 24224 til S-kurver. capsFor giver hvor mange der er af hver (ressourcer er optalt som
   * stykker / 30°-buer). Et skridt har { kind, use:[[res,antal]], disp, turn, pcs, ... }.
   */
  function stepsFor(spare0, o = {}) {
    const ns = o.straightN || N_LIST;
    const res = [], steps = [];
    // lige stykker: én ressource pr. længde (enhed 0,1 mm); varenumre med samme længde deles
    const classes = new Map();
    for (const p of C.STRAIGHTS) {
      const u = U(p.len);
      if (!classes.has(u)) classes.set(u, { u, arts: [] });
      classes.get(u).arts.push(p.art);
    }
    const cl = [...classes.values()].sort((a, b) => b.u - a.u);
    cl.forEach(c => c.arts.sort((x, y) => (!!C.BY_ART[x].func) - (!!C.BY_ART[y].func)));
    cl.forEach((c, ci) => {
      c.res = res.length; res.push({ kind: 'L', cls: c });
      ns.forEach(n => steps.push({ kind: 'L', cls: c, n, ci, use: [[c.res, n]], disp: [n * c.u, 0, 0, 0], turn: 0, pcs: n }));
    });
    // buer: m × 30° venstre og højre pr. radius (m = 1..6 i ét skridt, så en rute får få skridt)
    for (const [name, r] of R_ARC) {
      const ri = res.length; res.push({ kind: 'A', r });
      const R = U(r);
      for (const dir of [1, -1]) {
        let p = [0, 0, 0, 0], k = 0, m = 0;
        for (const target of (o.arcM || ARC_M)) {
          for (; m < target; m++) { p = add(p, rot(dir > 0 ? arcLeft(R) : arcRight(R), k)); k += dir; }
          steps.push({ kind: 'A', r, name, dir, m, use: [[ri, m]], disp: p, turn: dir * m, pcs: m });
        }
      }
    }
    // S-kurve af to 24224 (modkurver): parallelt spor 77,5 mm til siden, drejning 0. Forskydningen
    // afrundes til hele 0,1 mm (højst 0,05 mm fejl).
    if (!o.noMacros) {
      const si = res.length; res.push({ kind: 'S' });
      for (const dir of [1, -1]) {
        const w = C.walkAll({ x: 0, y: 0, h: 0 }, [C.arcG(dir), C.arcG(-dir)]);
        steps.push({ kind: 'M', dir, use: [[si, 2]], disp: [U(w.x), 0, 0, U(w.y)], turn: 0, pcs: 2 });
      }
    }
    steps.forEach(s => { s.r0 = s.use[0][0]; s.n0 = s.use[0][1]; s.R = []; s.XY = []; for (let k = 0; k < 12; k++) { s.R.push(rot(s.disp, k)); const t = toXY(s.R[k]); s.XY.push([t.x, t.y]); } });
    const stepsObj = { steps, res };
    stepsObj.capsFor = sp => {
      const caps = new Int32Array(res.length);
      res.forEach((r, i) => {
        if (r.kind === 'L') caps[i] = r.cls.arts.reduce((a, x) => a + Math.max(0, sp[x] || 0), 0);
        else if (r.kind === 'A') caps[i] = Math.floor(C.capacity(sp, r.r) / 30 + 1e-9);
        else caps[i] = Math.floor(Math.max(0, sp['24224'] || 0) / 2);
      });
      return caps;
    };
    return stepsObj;
  }

  // ---------- bredde-først-søgning ----------
  /**
   * Alle (position, retning) der kan nås fra stillingen `start` ({x,y,h}) med højst o.depth skridt.
   * Pr. tilstand gemmes højst o.perState (3) veje, færrest skinner først.
   *   o: { depth, maxStates, box:{x0,y0,x1,y1} (verdenskoordinater, mm), maxTurn (7), caps, rng, dir (kun buer til den side) }
   * Returnerer { states: Map, list: [tilstande], start }. En tilstand er { p:[a,b,c,d], k, x, y, nodes:[node] }
   * og en node { st, par, step, pcs, turn, depth } (en vej: følg par tilbage).
   */
  function bfs(start, S, o) {
    const { steps } = S, nS = steps.length, caps = o.caps, nR = S.res.length;
    const maxStates = o.maxStates || 60000, depth = o.depth || 7, maxTurn = o.maxTurn === undefined ? 7 : o.maxTurn, perState = o.perState || 3;
    const box = o.box || null;
    const cs = Math.cos(start.h * D2R), sn = Math.sin(start.h * D2R);
    // verdensforskydning pr. skridt og retning
    const DX = new Float64Array(nS * 12), DY = new Float64Array(nS * 12);
    steps.forEach((s, i) => { for (let k = 0; k < 12; k++) { DX[i * 12 + k] = cs * s.XY[k][0] - sn * s.XY[k][1]; DY[i * 12 + k] = sn * s.XY[k][0] + cs * s.XY[k][1]; } });
    // skridt der overhovedet kan bruges (ressourcen findes)
    let usable = [];
    for (let i = 0; i < nS; i++) if (steps[i].use.every(([r, n]) => caps[r] >= n) && (o.dir === undefined || steps[i].kind !== 'A' || steps[i].dir === o.dir)) usable.push(i);
    if (o.rng) { usable = usable.slice(); for (let i = usable.length - 1; i > 0; i--) { const j = Math.floor(o.rng() * (i + 1)); [usable[i], usable[j]] = [usable[j], usable[i]]; } }
    const states = new Map(), list = [];
    const root = { p: [0, 0, 0, 0], k: 0, x: start.x, y: start.y, nodes: [] };
    const rn = { st: root, par: null, step: -1, pcs: 0, turn: 0, depth: 0 };
    root.nodes.push(rn);
    states.set(hkey(0, 0, 0, 0, 0), root); list.push(root);
    let frontier = [rn];
    const used = new Int32Array(nR);
    for (let d = 1; d <= depth && frontier.length && list.length < maxStates; d++) {
      const next = [];
      for (const nd of frontier) {
        if (nd.dead) continue;
        if (list.length >= maxStates) break;
        used.fill(0);
        for (let t = nd; t.par; t = t.par) { const q = steps[t.step]; used[q.r0] += q.n0; }
        const st = nd.st, k = st.k, p = st.p;
        const last = nd.step >= 0 ? steps[nd.step] : null;
        for (let ui = 0; ui < usable.length; ui++) {
          const si = usable[ui], s = steps[si];
          if (last) {
            if (last.kind === 'L' && s.kind === 'L' && s.ci <= last.ci) continue;                          // lige stykker i fast rækkefølge efter længde
            if (last.kind === 'A' && s.kind === 'A' && s.r === last.r && s.dir === last.dir) continue;        // samme bue findes som ét skridt
          }
          const turn = nd.turn + s.turn;
          if (turn > maxTurn || turn < -maxTurn) continue;
          if (used[s.r0] + s.n0 > caps[s.r0]) continue;
          const x = st.x + DX[si * 12 + k], y = st.y + DY[si * 12 + k];
          if (box && (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1)) continue;
          const r = s.R[k], a = p[0] + r[0], b = p[1] + r[1], c = p[2] + r[2], dd = p[3] + r[3], k2 = mod12(k + s.turn);
          const hk = hkey(a, b, c, dd, k2);
          let ns = states.get(hk);
          const pcs = nd.pcs + s.pcs;
          if (!ns) {
            if (list.length >= maxStates) continue;
            ns = { p: [a, b, c, dd], k: k2, x, y, nodes: [] };
            states.set(hk, ns); list.push(ns);
          } else if (ns.nodes.length >= perState) {
            // fuld: kun hvis den nye vej er kortere end den dårligste
            let wi = 0;
            for (let i = 1; i < ns.nodes.length; i++) if (ns.nodes[i].pcs > ns.nodes[wi].pcs) wi = i;
            if (ns.nodes[wi].pcs <= pcs) continue;
            ns.nodes[wi].dead = true; ns.nodes.splice(wi, 1);
          }
          const node = { st: ns, par: nd, step: si, pcs, turn, depth: d };
          ns.nodes.push(node); next.push(node);
        }
      }
      frontier = next;
    }
    return { states, list, start };
  }

  /** Skridtene fra roden til en node. */
  function pathSteps(node, S) {
    const out = [];
    for (let t = node; t.par; t = t.par) out.push(S.steps[t.step]);
    return out.reverse();
  }
  const countUse = (steps, nR) => { const u = new Int32Array(nR); for (const s of steps) for (const [r, n] of s.use) u[r] += n; return u; };

  /**
   * Lav rigtige skinner ud af skridt (i kørselsretningen). sp = lageret (muteres); null hvis det ikke rækker.
   * Lige stykker får run-id (delt af stykker der ligger efter hinanden), 24188 yderst i hver strækning.
   */
  function buildPieces(steps, sp) {
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const id = C.newRunId();
      run.sort((x, y) => (x === '24188') - (y === '24188'));
      run.forEach(a => out.push({ ...C.linePiece(a), run: id }));
      run = [];
    };
    for (const s of steps) {
      if (s.kind === 'L') {
        for (let i = 0; i < s.n; i++) {
          const a = s.cls.arts.find(x => (sp[x] || 0) > 0);
          if (!a) return null;
          sp[a]--; run.push(a);
        }
        continue;
      }
      flush();
      if (s.kind === 'A') {
        for (let i = 0; i < s.m; i++) {
          const arts = C.takeArc(sp, s.r, 30); if (!arts) return null;
          out.push(...C.arcPieces(arts, s.dir));
        }
      } else {
        if ((sp['24224'] || 0) < 2) return null;
        sp['24224'] -= 2;
        out.push({ art: '24224', geo: C.arcG(s.dir) }, { art: '24224', geo: C.arcG(-s.dir) });
      }
    }
    flush();
    return out;
  }
  /** Gentag run-id'er hen over en hel liste (efter sammensætning af to halvdele): stykker der ligger efter hinanden deler id. */
  function mergeRuns(pieces) {
    let cur;
    for (const p of pieces) {
      if (p.run === undefined) { cur = undefined; continue; }
      if (cur === undefined) cur = p.run; else p.run = cur;
    }
    return pieces;
  }

  MK.lattice = { add, sub, neg, rot, toXY, eq, key, hkey, mod12, fromPose, headClass, stepsFor, bfs, pathSteps, countUse, buildPieces, mergeRuns, arcLeft, arcRight, N_LIST };
})(typeof self !== 'undefined' ? self : globalThis);
