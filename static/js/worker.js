/* Web Worker: genererer baner løbende og sender hver bane tilbage, indtil siden stopper den. */
/* global importScripts, MK */
const V = new URL(self.location.href).searchParams.get('v') || '';
importScripts(`core.js?v=${V}`, `graph.js?v=${V}`, `lattice.js?v=${V}`, `topologies.js?v=${V}`, `elements.js?v=${V}`, `router.js?v=${V}`, `generator.js?v=${V}`);
let job = 0;
self.onmessage = e => {
  const { id, inv, opts, cmd } = e.data;
  if (cmd === 'stop') { job = 0; return; }
  job = id;
  const avoid = new Set(opts.avoid || []);
  let k = 0;
  // skift grundform for hver bane, så alle typer kommer med (listen sorteres efter point bagefter)
  const topos = Object.keys(opts.topologies || {}).filter(t => opts.topologies[t]);
  const topoFor = k => topos.length > 1 ? Object.fromEntries(Object.keys(opts.topologies).map(t => [t, t === topos[k % topos.length]])) : opts.topologies;
  const step = () => {
    if (job !== id) return;
    let res;
    try {
      res = MK.generate(inv, { ...opts, topologies: topoFor(k), seed: (opts.seed + k * 104729) >>> 0, avoid: [...avoid].slice(-60) });
    } catch (err) {
      res = { error: 'Intern fejl: ' + (err && err.message || err) };
    }
    k++;
    if (res.sig) avoid.add(res.sig);
    self.postMessage({ id, result: res, k });
    setTimeout(step, 0);            // giver plads til en eventuel stop-besked
  };
  step();
};
