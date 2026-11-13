/*
 * Web Worker: kører vedvarende søgesessioner (generator v2) og sender hver ny bane tilbage, indtil siden stopper den.
 * Beskeder ind:  { cmd: 'start', id, inv, opts, first, runMs }  – én session pr. valgt grundform; first = grundformen der startes med
 *                { cmd: 'avoid', sig }                          – en bane der allerede er vist (lægges i alle sessioners avoid)
 *                { cmd: 'stop' }
 * Beskeder ud:   { id, result, k, uid, replaces }  – uid er unikt i denne worker; replaces = uid for den bane resultatet erstatter
 */
/* global importScripts, MK */
const V = new URL(self.location.href).searchParams.get('v') || '';
importScripts(`core.js?v=${V}`, `graph.js?v=${V}`, `lattice.js?v=${V}`, `topologies.js?v=${V}`, `elements.js?v=${V}`, `router.js?v=${V}`, `generator.js?v=${V}`, `search.js?v=${V}`);
let job = 0;
self.onmessage = e => {
  const { id, inv, opts, cmd } = e.data;
  if (cmd === 'stop') { job = 0; sessions = []; return; }
  if (cmd === 'avoid') { for (const s of sessions) s.session.addAvoid(e.data.sig); if (Array.isArray(pendingAvoid)) pendingAvoid.push(e.data.sig); else pendingAvoid.add(e.data.sig); return; }
  job = id;
  const runMs = e.data.runMs || 2500;
  const topos = Object.keys(opts.topologies || {}).filter(t => opts.topologies[t]);
  const first = e.data.first || 0;
  if (!(opts.maximize || opts.allSwitches)) {
    // kort tilstand: én hurtig bane ad gangen som før (generate), grundformerne på skift
    const avoid = new Set([...(opts.avoid || []), ...pendingAvoid]);
    pendingAvoid = avoid;
    const topoFor = k => topos.length > 1 ? Object.fromEntries(Object.keys(opts.topologies).map(t => [t, t === topos[(first + k) % topos.length]])) : opts.topologies;
    let n = 0;
    const quick = () => {
      if (job !== id) return;
      let res;
      try {
        res = MK.generate(inv, { ...opts, topologies: topoFor(n), seed: (opts.seed + n * 104729) >>> 0, avoid: [...avoid].slice(-60) });
      } catch (err) {
        res = { error: 'Intern fejl: ' + (err && err.message || err) };
      }
      n++;
      if (res.sig) avoid.add(res.sig);
      self.postMessage({ id, result: res, k: n, uid: res.error ? 0 : n, replaces: 0 });
      setTimeout(quick, 0);
    };
    quick();
    return;
  }
  // én session pr. grundform (hvis der kun er én valgt: den ene); seed forskudt pr. session
  sessions = (topos.length ? topos : [null]).map((t, i) => ({
    topo: t, ids: new Map(),
    session: MK.createSession(inv, {
      ...opts, avoid: [...(opts.avoid || []), ...pendingAvoid], seed: (opts.seed + i * 104729) >>> 0,
      topologies: t ? Object.fromEntries(Object.keys(opts.topologies).map(x => [x, x === t])) : opts.topologies,
    }),
  }));
  let k = 0, uid = 0;
  const step = () => {
    if (job !== id) return;
    // grundformerne på skift, så alle typer kommer hurtigt på skærmen; worker i begynder med grundform nr. i
    const s = sessions[(first + k) % sessions.length];
    let res;
    try {
      res = s.session.next(runMs);
    } catch (err) {
      res = { error: 'Intern fejl: ' + (err && err.message || err) };
    }
    k++;
    if (res.idle) { setTimeout(step, 0); return; }              // intet nyt: ingen besked
    let u = 0, replaces = 0;
    if (!res.error) {
      u = ++uid;
      s.ids.set(res.id, u);
      if (res.replaces) replaces = s.ids.get(res.replaces) || 0;
    }
    self.postMessage({ id, result: res, k, uid: u, replaces });
    setTimeout(step, 0);            // giver plads til en eventuel stop-besked
  };
  step();
};
let sessions = [], pendingAvoid = [];
