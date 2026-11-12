/*
 * Sporgraf: bygger en graf af banens fysiske skinner ud fra deres ender og bruger den til
 *  · kontrol – hver skinneende skal møde præcis én anden ende (undtagen prelbukke),
 *  · analyse – hænger alt sammen, hvor mange uafhængige ruter er der, og kan et tog vende
 *    (køre tilbage over samme skinne i modsat retning uden at bakke).
 * Grafen udledes af geometrien alene, så den er en uafhængig kontrol af generatoren.
 */
(function (root) {
  'use strict';
  const MK = root.MK;
  const C = MK.core;
  const { BY_ART, norm180 } = C;

  const JOIN_TOL = 2.5;      // mm – største spalte i en samling
  const ANG_TOL = 2;         // grader

  /** Fysiske skinner med porte (ender, udadrettet retning) og hvilke porte der er forbundet indbyrdes. */
  function physical(layout) {
    const out = [];
    const startPort = p => ({ x: p.start.x, y: p.start.y, h: p.start.h + 180 });
    const endPort = p => ({ x: p.end.x, y: p.end.y, h: p.end.h });
    const add = (p, where) => {
      const kind = BY_ART[p.art].kind;
      const twoTrack = kind === 'crossing' || kind === 'dslip';
      if (p.virtual && !twoTrack) return;
      if (p.buffer || kind === 'buffer') { out.push({ p, where, art: p.art, ports: [startPort(p)], links: [], buffer: true }); return; }
      if (p.virtual && twoTrack) {
        // krydsningens andet spor: slås sammen med den rigtige skinne (nærmeste med samme varenummer)
        const twin = out.filter(q => q.art === p.art && q.twoTrack && q.ports.length === 2)
          .sort((a, b) => Math.hypot(a.p.start.x - p.start.x, a.p.start.y - p.start.y) - Math.hypot(b.p.start.x - p.start.x, b.p.start.y - p.start.y))[0];
        if (twin) {
          twin.ports.push(startPort(p), endPort(p));
          twin.links.push([2, 3]);
          if (kind === 'dslip') {
            // porte på samme side som port 0 kan nå begge porte på den modsatte side
            const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
            const near0 = d(twin.ports[2], twin.ports[0]) < d(twin.ports[3], twin.ports[0]) ? 2 : 3;
            const far = near0 === 2 ? 3 : 2;
            twin.links.push([0, far], [near0, 1]);
          }
          return;
        }
      }
      const e = { p, where, art: p.art, ports: [startPort(p), endPort(p)], links: [[0, 1]], twoTrack };
      if (p.branch) {
        const tongue = p.branch.from === 'start' ? 0 : 1;
        if (tongue === 1) e.ports.reverse();          // port 0 = tungen
        for (const pts of C.branchPtsOf(p)) {
          const q = pts[pts.length - 1];
          e.links.push([0, e.ports.length]);
          e.ports.push({ x: q.x, y: q.y, h: q.h });
        }
      }
      out.push(e);
    };
    layout.chains.forEach((ch, ci) => ch.pieces.forEach(p => add(p, { chain: ci, kind: ch.kind })));
    (layout.sides || []).forEach((sd, si) => sd.pieces.forEach(p => add(p, { side: si, kind: sd.type })));
    return out;
  }

  function build(layout) {
    const pieces = physical(layout);
    const ports = [];
    pieces.forEach((e, pi) => e.ports.forEach((q, k) => ports.push({ x: q.x, y: q.y, h: q.h, pi, k, mate: -1, joint: -1 })));
    pieces.forEach((e, pi) => { e.base = 0; });
    let base = 0;
    for (const e of pieces) { e.base = base; base += e.ports.length; }
    const cell = 20, grid = new Map();
    const key = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
    ports.forEach((q, i) => { const k = key(q.x, q.y); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i); });
    const problems = [];
    let joints = 0;
    ports.forEach((q, i) => {
      if (q.joint >= 0) return;
      const near = [];
      const cx = Math.floor(q.x / cell), cy = Math.floor(q.y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get((cx + dx) + ',' + (cy + dy)) || []) {
          if (j !== i && Math.hypot(ports[j].x - q.x, ports[j].y - q.y) <= JOIN_TOL) near.push(j);
        }
      }
      q.joint = joints++;
      near.forEach(j => { ports[j].joint = q.joint; });
      if (near.length === 1) {
        const m = ports[near[0]];
        q.mate = near[0]; m.mate = i;
        if (Math.abs(norm180(q.h - m.h - 180)) > ANG_TOL) problems.push({ type: 'knæk', x: q.x, y: q.y, arts: [pieces[q.pi].art, pieces[m.pi].art], ang: norm180(q.h - m.h - 180) });
      } else if (near.length === 0) {
        problems.push({ type: 'åben ende', x: q.x, y: q.y, arts: [pieces[q.pi].art], where: pieces[q.pi].where });
      } else {
        problems.push({ type: 'flere skinner i samme samling', x: q.x, y: q.y, arts: [q, ...near.map(j => ports[j])].map(t => pieces[t.pi].art) });
      }
    });
    return { pieces, ports, joints, problems };
  }

  /** Alle skinneender skal være samlet – returnerer listen af fejl (tom = i orden). */
  const validate = layout => build(layout).problems;

  function analyze(layout) {
    const g = build(layout);
    const { pieces, ports } = g;
    // sammenhæng og uafhængige ruter (cyklomatisk tal E − V + K)
    const par = Array.from({ length: g.joints }, (_, i) => i);
    const find = a => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
    let edges = 0;
    for (const e of pieces) for (const [a, b] of e.links) { edges++; par[find(ports[e.base + a].joint)] = find(ports[e.base + b].joint); }
    const comps = new Set(par.map((_, i) => find(i))).size;
    const routes = edges - g.joints + comps;
    // retningsgraf: tilstand = (skinne, port toget forlader skinnen ad)
    const nextOf = s => {
      const m = ports[s].mate; if (m < 0) return [];
      const e = pieces[ports[m].pi], k = ports[m].k, res = [];
      for (const [a, b] of e.links) { if (a === k) res.push(e.base + b); else if (b === k) res.push(e.base + a); }
      return res;
    };
    const reach = from => {
      const seen = new Uint8Array(ports.length), st = [from]; seen[from] = 1;
      while (st.length) for (const n of nextOf(st.pop())) if (!seen[n]) { seen[n] = 1; st.push(n); }
      return seen;
    };
    // referenceskinne: første almindelige skinne i første kæde
    const ref = pieces.find(e => e.where.chain === 0 && e.ports.length === 2 && !e.buffer) || pieces.find(e => e.ports.length === 2 && !e.buffer);
    let reverse = 0, covered = 1, trap = 0;
    if (ref) {
      const fw = reach(ref.base + 1), bw = reach(ref.base);
      reverse = (fw[ref.base] ? 1 : 0) + (bw[ref.base + 1] ? 1 : 0);
      // fælder: skinner et tog kan køre ind på, men ikke komme tilbage til hovedsporet fra uden at bakke
      // (blindspor med prelbuk tæller ikke – dér er det meningen)
      const rev = Array.from({ length: ports.length }, () => []);
      for (let st = 0; st < ports.length; st++) for (const n of nextOf(st)) rev[n].push(st);
      const back = seeds => {
        const seen = new Uint8Array(ports.length), q = seeds.slice(); q.forEach(x => { seen[x] = 1; });
        while (q.length) for (const n of rev[q.pop()]) if (!seen[n]) { seen[n] = 1; q.push(n); }
        return seen;
      };
      const home = back([ref.base, ref.base + 1]);
      const bufSeeds = [];
      pieces.forEach(e => { if (e.buffer) { const m = ports[e.base].mate; if (m >= 0) bufSeeds.push(m); } });
      const toBuf = back(bufSeeds);
      for (const e of pieces) {
        if (e.buffer) continue;
        let t = false;
        for (let k = 0; k < e.ports.length; k++) { const x = e.base + k; if ((fw[x] || bw[x]) && !home[x] && !toBuf[x]) t = true; }
        if (t) trap++;
      }
      // andel af skinner et tog kan nå kørende fremad (begge retninger tilsammen)
      let hit = 0, tot = 0;
      for (const e of pieces) { if (e.buffer) continue; tot++; let ok = false; for (let k = 0; k < e.ports.length; k++) if (fw[e.base + k] || bw[e.base + k]) ok = true; if (ok) hit++; }
      covered = tot ? hit / tot : 1;
    }
    return {
      problems: g.problems, components: comps, routes, reverse, covered, trap,
      deadEnds: pieces.filter(e => e.buffer).length,
      open: g.problems.filter(p => p.type === 'åben ende').length,
    };
  }

  MK.graph = { build, validate, analyze };
})(typeof self !== 'undefined' ? self : globalThis);
