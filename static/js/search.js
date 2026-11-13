/*
 * Vedvarende søgning (generator v2). I stedet for mange uafhængige forsøg lever en session på tværs af kald:
 *
 *  · en pulje af grundformer (T0), bygget med fase 1's kode og genbrugt hele sessionen
 *  · en stråle pr. trin med de bedste knuder (kontrolpunkter) – en dyr mellemtilstand kan fortsættes flere gange
 *  · adaptivt valg (Thompson-trækning) af vækst, stammer, rækkefølge og hvilke elementer der prøves,
 *    ud fra point pr. millisekund
 *  · en forbedringsfase der bliver ved med at lægge spor på de bedste baner
 *  · et arkiv med én plads pr. banetype (niche), så listen forbliver varieret
 *
 * Trin (se SPEC-generator-v2.md 5.2):
 *   T0 grundform · T1 vokset og placeret · T2 ringe forbundet · T3 'Skal' + station · T4 ruter og stationer · T5 sidespor (færdig)
 * T2 udføres sammen med T3, så strålerne holder T1-, T3- og T4-knuder; T5-knuder går til arkivet.
 *
 * Al tilfældighed kommer fra sessionens rng (opts.seed). Uret bruges kun til tidsgrænser; med opts.maxIterations
 * (kun til test) slås alle tidsgrænser fra, og sessionen er helt deterministisk.
 */
(function (root) {
  'use strict';
  const MK = root.MK;
  const C = MK.core;
  const G = MK.compose;

  const BEAM = 6;                      // knuder pr. stråle
  const PER_SIG = 2;                   // højst så mange knuder fra samme grundform i en stråle
  const STAGE_W = [30, 20, 30, 20];    // T0→T1, T1→T3, T3→T4, T4→T5
  const IMPROVE_SHARE = 0.2;           // andel af tiden til forbedringsfasen
  const IMPROVE_FAILS = 8;             // forsøg i træk uden forbedring før en bane er mættet
  const clip01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const IMPROVE_P0 = { link: 0.6, siding: 0.4, csiding: 0.4, threeway: 0.25, passing: 0.25, cpassing: 0.2, fill: 0.5 };
  const IMPROVE_IDS = ['link', 'siding', 'csiding', 'threeway', 'passing', 'cpassing', 'spassing', 'cutoff', 'stub', 'fill'];

  function createSession(inv, opts) {
    const ctx = G.makeContext(inv, opts);
    if (ctx.error) {
      const error = ctx.error;
      return { next: () => ({ error }), stats: () => ({ iterations: 0, nodes: 0, archive: [], arms: [] }), addAvoid() {} };
    }
    const { o, rng, mode } = ctx;
    const det = !!o.maxIterations;         // testtilstand: ingen ure
    if (det) o.noTime = true;
    const msOf = ms => det ? 1 : ms;

    // ---------- adaptivt valg ----------
    const arms = new Map(), groups = new Map();
    const gain = { n: 2, sum: 0.1 };       // gennemsnitlig gevinst pr. prøvet element (baseline for "spring over")
    const getArm = (group, id, p0) => {
      let a = arms.get(id);
      if (!a) {
        a = { id, group, n: 0, sum: 0, ms: 0, chosen: 0, a0: 3 * p0, b0: 3 * (1 - p0) };
        arms.set(id, a);
        if (!groups.has(group)) groups.set(group, { chosen: 0 });
      }
      return a;
    };
    const armMs = a => a.n ? a.ms / a.n : 0;
    /** Thompson-trækning blandt list = [{ id, p0 }] (p0 = forhåndsviden). refMs: sammenligningstid til tidsvægtningen. */
    function choose(group, list, refMs) {
      const as = list.map(x => getArm(group, x.id, x.p0));
      const known = as.filter(a => a.n && a.ms > 0).map(armMs);
      const fallback = known.length ? known.reduce((x, y) => x + y, 0) / known.length : 1;
      const cost = as.map(a => a.n && a.ms > 0 ? armMs(a) : (a.n ? 0 : fallback));
      const pos = cost.filter(c => c > 0);
      const ref = refMs || (pos.length ? Math.max(1, Math.min(...pos)) : 1);
      let pick;
      const eps = Math.min(0.5, 0.05 * as.length);          // bund: alle arme mindst 5 %
      if (rng() < eps) pick = as[Math.floor(rng() * as.length)];
      else {
        let bestV = -1;
        as.forEach((a, i) => {
          const draw = C.betaDraw(rng, 1 + a.a0 + a.sum, 1 + a.b0 + Math.max(0, a.n - a.sum));
          const f = Math.max(1, Math.min(4, cost[i] / ref));
          if (draw / f > bestV) { bestV = draw / f; pick = a; }
        });
      }
      pick.chosen++; groups.get(group).chosen++;
      return pick;
    }
    const reward = (a, g, ms) => { a.n++; a.sum += g; a.ms += ms; };
    const medianElementMs = () => {
      const v = [...arms.values()].filter(a => a.group.startsWith('el:') && a.id.endsWith(':try') && a.n).map(armMs).sort((x, y) => x - y);
      return Math.max(5, v.length ? v[Math.floor(v.length / 2)] : 5);
    };
    /** Ja/nej-valg. Returnerer { yes, arm }; armen skal have reward() efter udførelsen. */
    function decide(group, p0) {
      const t = getArm(group, group + ':try', p0), s = getArm(group, group + ':skip', 1 - p0);
      const pick = choose(group, [{ id: t.id, p0 }, { id: s.id, p0: 1 - p0 }], medianElementMs());
      if (pick === s) { reward(s, gain.sum / gain.n, 0); return { yes: false }; }
      return { yes: true, arm: t };
    }
    const sometimesP = id => {
      const el = MK.elements.find(e => e.id === id);
      return Math.max(0.1, Math.min(0.95, el && el.sometimes ? el.sometimes : (ctx.long ? 0.9 : 0.65)));
    };

    // ---------- tilstand ----------
    const beams = { 1: [], 3: [], 4: [] };               // knuder pr. trin
    const archive = new Map();                           // niche → { niche, score, node, ev, base, returnedScore, returnedId, fails, saturated }
    const maxGain = { 1: Infinity, 3: Infinity, 4: Infinity };   // største set gevinst fra trinnet til en færdig bane
    const finishedPts = [];
    let iterations = 0, nodeCount = 0, invalid = 0, finished = 0, retId = 0, nodeId = 0;
    let tImprove = 0, tTotal = 0;
    let poolSeeded = false;
    const nicheLast = new Map();                         // niche → id på sidst returnerede bane

    const rankPick = list => {
      const w = list.map((_, r) => Math.pow(2, -r / 2));      // bedste dobbelt så ofte som nr. 3
      return C.pickW(rng, list, w);
    };
    const cloneNode = n => ({
      trin: n.trin, layout: C.cloneLayout(n.layout), used: Object.assign({}, n.used), station: C.deep(n.station),
      stemmed: n.stemmed, order: n.order, base: n.base, parent: n, point: n.point, id: ++nodeId, choices: [], gain: 0,
    });
    const worstArchive = () => { let w = Infinity; archive.forEach(e => { if (e.score < w) w = e.score; }); return w; };
    const nicheOf = (node, ev, base) => `${base.topo}|${Math.min(2, node.layout.chains.filter(c => c.kind === 'ring').length)}|${Math.min(2, ev.an.reverse)}`;

    function insertBeam(trin, node) {
      const list = beams[trin], sig = node.base.sig;
      if (trin > 1 && archive.size >= 4 && node.point + maxGain[trin] < worstArchive()) return false;   // svag gren: kan ikke nå arkivet
      const same = list.filter(n => n.base.sig === sig);
      if (same.length >= PER_SIG) {
        const worst = same.reduce((a, b) => b.point < a.point ? b : a);
        if (worst.point >= node.point) return false;
        list.splice(list.indexOf(worst), 1);
      }
      list.push(node);
      // T1: en ring er endnu ikke forbundet (og giver derfor ingen point), men er den største enkelte gevinst bagefter
      const key = n => n.point + (n.trin === 1 ? n.layout.chains.filter(c => c.kind === 'ring').length * 600 : 0);
      list.sort((a, b) => key(b) - key(a) || a.id - b.id);
      if (list.length > BEAM) list.length = BEAM;
      return list.includes(node);
    }

    // ---------- færdige baner og læring fra afkom ----------
    function median(a) { const b = a.slice().sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; }
    function creditAncestors(node, point) {
      const ref = finishedPts.length ? median(finishedPts) : null;
      for (let n = node.parent; n; n = n.parent) {
        const g = point - n.point;
        if (g > maxGain[n.trin]) maxGain[n.trin] = g;
        if (n.trin === 1 && ref !== null) {
          // T1-valgene (grundform, vækst, stammer) bedømmes på det bedste færdige afkom: over medianen er godt
          const gv = clip01((point - ref) / 1000 + 0.5);
          if (gv > n.gain) { for (const a of n.choices) a.sum += gv - n.gain; n.gain = gv; }
        }
      }
    }
    function addFinished(node, ev) {
      finished++;
      creditAncestors(node, ev.total);
      finishedPts.push(ev.total);
      const niche = nicheOf(node, ev, node.base);
      const cur = archive.get(niche);
      if (cur && cur.score >= ev.total) return null;
      const e = { niche, score: ev.total, node, ev, base: node.base, returnedScore: cur ? cur.returnedScore : null, returnedId: cur ? cur.returnedId : null, fails: 0, saturated: false };
      archive.set(niche, e);
      return e;
    }
    const finish = (node, ev) => addFinished(node, ev);

    // ---------- iterationer ----------
    function leftMs() { return det ? 100 : Math.max(0, o.deadline - Date.now()); }
    function baseWeights(list) { return list.map((c, r) => (c.avoided || ctx.avoid.has(c.sig) ? 0.05 : 1) / (r + 3)); }

    function expandT0(timing) {
      const pool = ctx.cands;
      if (!pool.length) return;
      const byTopo = new Map();
      for (const c of pool) { if (!byTopo.has(c.topo)) byTopo.set(c.topo, []); byTopo.get(c.topo).push(c); }
      const topoArm = choose('topo', [...byTopo.keys()].map(t => ({ id: 'topo:' + t, p0: 0.5 })));
      const list = byTopo.get(topoArm.id.slice(5)).slice().sort((a, b) => b.score - a.score);
      const base = C.pickW(rng, list, baseWeights(list));
      const frac = choose('frac', [0, 0.15, 0.35, 0.6, 1].map((f, i) => ({ id: 'frac:' + f, p0: (o.allSwitches || mode('inner') === 'must') ? 0.5 : (i === 4 ? 0.9 : 0.1) })));
      const valg = { frac: +frac.id.slice(5), stems: false, ccross: 1 };
      const choices = [topoArm, frac];
      if (o.maximize && mode('link') !== 'off' && C.cnt(inv, '24671') + C.cnt(inv, '24672') > 0) {
        const st = choose('stems', [{ id: 'stems:yes', p0: 0.75 }, { id: 'stems:no', p0: 0.25 }]);
        valg.stems = st.id === 'stems:yes'; choices.push(st);
      }
      const growMs = Math.max(40, Math.min(110, leftMs() / 20));
      const t = Date.now();
      const node = G.stepGrow(ctx, base, valg, growMs, timing);
      const ms = msOf(Date.now() - t);
      if (!node) { invalid++; choices.forEach(a => reward(a, 0, ms)); return; }
      const ev = G.evaluate(ctx, node);
      if (!ev.ok) { invalid++; choices.forEach(a => reward(a, 0, ms)); return; }
      Object.assign(node, { trin: 1, base, parent: null, point: ev.total, id: ++nodeId, choices, gain: 0 });
      choices.forEach(a => reward(a, 0, ms));
      nodeCount++;
      insertBeam(1, node);
    }

    function expandT1(timing) {
      const src = rankPick(beams[1]);
      const node = cloneNode(src); node.trin = 3;
      const hasRing = node.layout.chains.some(c => c.kind === 'ring');
      const choices = [];
      const valg = { ccross: 1 };
      if (hasRing && mode('ccross') !== 'off') {
        const cc = choose('ccross', [1, 2, 3].map(k => ({ id: 'ccross:' + k, p0: 1 / 3 })));
        valg.ccross = +cc.id.slice(7); choices.push(cc);
      }
      const rf = choose('routesFirst', [{ id: 'routes:first', p0: src.stemmed ? 0.9 : 0.5 }, { id: 'routes:last', p0: src.stemmed ? 0.1 : 0.5 }]);
      choices.push(rf);
      const t = Date.now();
      G.stepRings(ctx, node, valg);
      node.order = G.orderFor(ctx, node, rf.id === 'routes:first');
      G.stepMust(ctx, node, [...node.order.t4, ...node.order.t5], timing);
      const ms = msOf(Date.now() - t);
      const ev = G.evaluate(ctx, node);
      if (!ev.ok) { invalid++; choices.forEach(a => reward(a, 0, ms)); return; }
      node.point = ev.total;
      choices.forEach(a => reward(a, clip01((ev.total - src.point) / 1000), ms));
      nodeCount++;
      insertBeam(3, node);
    }

    /** Kører elementerne ids på node med adaptivt valg; måler gevinsten pr. element. */
    function runElements(node, ids, timing, group) {
      let cur = G.evaluate(ctx, node);
      const hooks = {
        decide: id => {
          const d = decide('el:' + node.base.topo + ':' + id, sometimesP(id));
          hooks.pending = d;
          return d.yes;
        },
        before: () => { cur = G.evaluate(ctx, node); },
        after: (id, n, ms) => {
          const ev = G.evaluate(ctx, node);
          const g = ev.ok && cur.ok && n ? clip01((ev.total - cur.total) / 1000) : 0;
          reward(hooks.pending.arm, g, msOf(ms));
          gain.n++; gain.sum += g;
        },
      };
      G.stepCan(ctx, node, ids, hooks, timing);
    }

    function expandT3(timing) {
      const src = rankPick(beams[3]);
      const node = cloneNode(src); node.trin = 4;
      runElements(node, node.order.t4, timing);
      const ev = G.evaluate(ctx, node);
      if (!ev.ok) { invalid++; return; }
      node.point = ev.total;
      nodeCount++;
      insertBeam(4, node);
    }

    function expandT4(timing) {
      const src = rankPick(beams[4]);
      const node = cloneNode(src); node.trin = 5;
      runElements(node, node.order.t5, timing);
      if (o.allSwitches) G.stepFill(ctx, node, timing);
      const ev = G.evaluate(ctx, node);
      if (!ev.ok) { invalid++; return null; }
      node.point = ev.total;
      nodeCount++;
      return finish(node, ev);
    }

    // ---------- forbedringsfasen ----------
    function improveOne(timing) {
      const cand = [...archive.values()].filter(e => !e.saturated).sort((a, b) => b.score - a.score || (a.niche < b.niche ? -1 : 1));
      if (!cand.length) return false;
      const entry = rankPick(cand);
      const ids = IMPROVE_IDS.filter(id => id === 'fill' ? o.allSwitches : mode(id) !== 'off');
      if (!ids.length) { entry.saturated = true; return true; }
      const tp = entry.base.topo;
      const arm = choose('imp:' + tp, ids.map(id => ({ id: 'imp:' + tp + ':' + id, p0: IMPROVE_P0[id] || 0.15 })));
      const id = arm.id.slice(5 + tp.length);
      const node = cloneNode(entry.node); node.trin = 5; node.parent = entry.node;
      const t = Date.now();
      let n = 0;
      if (id === 'fill') { const before = Object.keys(node.used).length; G.stepFill(ctx, node, timing); n = Object.keys(node.used).length >= before ? 1 : 0; }
      else if (id === 'link') {
        // forbedringsfasen søger dybere end fase 2 (flere porte, dybere gittersøgning, længere tid pr. søgning)
        n = MK.router.addLinks(node.layout, inv, C.subDeadline(o, 0.25), rng, 1, { ports: 80, depth: 6, maxStates: 12000, ms: 250, pick: 10 });
        if (n) node.used.link = (node.used.link || 0) + n;
      } else n = G.applyElement(ctx, node, id, timing, true);
      const ms = msOf(Date.now() - t);
      const ev = n ? G.evaluate(ctx, node) : { ok: false };
      finished++; improveTried++;
      if (ev.ok && ev.total > entry.score) {
        reward(arm, clip01((ev.total - entry.score) / 1000), ms);
        node.point = ev.total;
        creditAncestors(node, ev.total);
        finishedPts.push(ev.total);
        const niche = nicheOf(node, ev, entry.base);
        const prev = archive.get(niche);
        if (niche !== entry.niche) archive.delete(entry.niche);
        if (!prev || prev === entry || prev.score < ev.total) {
          const keep = niche === entry.niche ? entry : prev;
          archive.set(niche, { niche, score: ev.total, node, ev, base: entry.base, returnedScore: keep ? keep.returnedScore : null, returnedId: keep ? keep.returnedId : null, fails: 0, saturated: false });
        }
      } else {
        reward(arm, 0, ms);
        if (ev.ok === false && n) invalid++;
        if (++entry.fails >= IMPROVE_FAILS) entry.saturated = true;
      }
      return true;
    }
    let improveTried = 0;

    // ---------- hovedløkken ----------
    function iterate(timing) {
      const t = Date.now();
      let improved = false;
      if (archive.size && (det ? iterations % 5 === 4 : tImprove < IMPROVE_SHARE * (tTotal + 1))) improved = improveOne(timing);
      if (!improved) {
        // vælg trin; er strålen før det tom, falder valget tilbage til et tidligere trin
        let stage = C.pickW(rng, [0, 1, 2, 3], STAGE_W);
        const src = [null, 1, 3, 4];
        while (stage > 0 && !beams[src[stage]].length) stage--;
        if (stage === 0) expandT0(timing);
        else if (stage === 1) expandT1(timing);
        else if (stage === 2) expandT3(timing);
        else expandT4(timing);
      }
      iterations++;
      const dt = Date.now() - t;
      tTotal += dt;
      if (improved) tImprove += dt;
    }

    // ---------- resultater ----------
    const isNew = e => e.returnedId === null || e.returnedId === undefined ||
      e.score - e.returnedScore >= 0.03 * Math.max(1, Math.abs(e.returnedScore));
    function pickResult() {
      const c = [...archive.values()].filter(isNew);
      if (!c.length) return null;
      const av = e => ctx.avoid.has(e.base.sig) || e.base.avoided;
      c.sort((a, b) => (av(a) - av(b)) || b.score - a.score || (a.niche < b.niche ? -1 : 1));
      return c[0];
    }

    /** Arbejder i højst ms; maxExtra = andel ekstra tid hvis der intet nyt er at returnere (standard 0,5; generate bruger 0,08). */
    function next(ms, maxExtra = 0.5) {
      const t0 = Date.now();
      o.deadline = det ? Infinity : t0 + ms;
      const timing = {};
      const before = { finished, invalid, imp: improveTried };
      // grundformer: første kald højst 10 % af tiden (til 24 er fundet), senere højst 5 %
      const tP = Date.now();
      if (!poolSeeded) {
        G.findBases(ctx, det ? Infinity : t0 + 0.1 * ms, 24);
        poolSeeded = true;
      } else if (!det) G.findBases(ctx, t0 + 0.05 * ms, 12);
      timing.bases = Date.now() - tP;
      if (!ctx.cands.length) {
        return { error: 'Kunne ikke finde en bane der passer. Prøv en større plade, flere spor eller tillad flere grundformer.', attempts: ctx.attempts };
      }
      const run = until => {
        let k = 0;
        while (det ? k < o.maxIterations : Date.now() < until) {
          iterate(timing); k++;
          if (det && k >= o.maxIterations) break;
        }
      };
      run(t0 + ms);
      let pick = pickResult();
      if (!pick && !det) {
        // intet nyt at returnere: arbejd videre i op til 50 % ekstra tid
        const until = Date.now() + maxExtra * ms;
        o.deadline = until;
        while (Date.now() < until && !(pick = pickResult())) iterate(timing);
      }
      if (!pick) {
        if (!archive.size) return { error: G.noBaseError(ctx), attempts: ctx.attempts };
        return { error: null, idle: true };
      }
      const replaces = pick.returnedId || null;
      const res = G.buildResult(ctx, { node: pick.node, ev: pick.ev, base: pick.base }, {
        timing, attempts: ctx.attempts, valid: ctx.cands.length, tried: (finished - before.finished), invalid: invalid - before.invalid,
        iterations, nodes: nodeCount, improved: improveTried - before.imp, ms: Date.now() - t0,
      });
      res.id = ++retId; res.niche = pick.niche; if (replaces) res.replaces = replaces;
      pick.returnedId = res.id; pick.returnedScore = pick.score;
      return res;
    }

    return {
      next,
      addAvoid(sig) { ctx.avoid.add(sig); },
      stats() {
        return {
          iterations, nodes: nodeCount, finished, invalid,
          beams: Object.fromEntries(Object.entries(beams).map(([k, l]) => [k, l.map(n => ({ point: Math.round(n.point), rings: n.layout.chains.filter(c => c.kind === 'ring').length, sig: n.base.sig, pieces: G.countUsed(n.layout) }))])),
          archive: [...archive.values()].map(e => ({ key: e.niche, score: e.score, saturated: e.saturated })),
          arms: [...arms.values()].map(a => ({ id: a.id, group: a.group, n: a.n, mean: a.n ? a.sum / a.n : 0, msMean: armMs(a), chosen: a.chosen, share: groups.get(a.group).chosen ? a.chosen / groups.get(a.group).chosen : 0 })),
        };
      },
    };
  }

  MK.createSession = createSession;
  MK.search = { createSession };
})(typeof self !== 'undefined' ? self : globalThis);
