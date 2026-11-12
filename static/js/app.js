(function () {
  'use strict';
  const MK = window.MK;
  const G = MK.core;
  const $ = id => document.getElementById(id);

  // Farver (faste i SVG, så eksporten ser ens ud)
  const COL = {
    board: '#e9dcc3', boardEdge: '#b89b6c', grid: 'rgba(120,90,40,.16)', gridTxt: '#8a7350',
    bed: { straight: '#8d9097', R1: '#6f8fb5', R2: '#6aa37a', R3: '#c49a4a', R4: '#b57aa8', R5: '#5fa8a8', R9: '#7d8f4e', switch: '#c0463d', buffer: '#555' },
    sleeper: 'rgba(60,40,25,.55)', rail: '#d9dadc', joint: '#2a2a2a', pin: '#b3261e',
  };
  const catColor = art => {
    const c = G.BY_ART[art];
    if (c.kind === 'straight') return COL.bed.straight;
    if (c.kind === 'curve') return COL.bed[c.rn];
    if (c.kind === 'switch' || c.kind === 'switch3' || c.kind === 'cswitch' || c.kind === 'sswitch' || c.kind === 'dslip') return COL.bed.switch;
    if (c.kind === 'crossing') return '#8e5bb5';
    return COL.bed.buffer;
  };

  const PRESETS = {
    small: { '24130': 12, '24188': 6, '24172': 2, '24071': 1 },
    medium: { '24130': 12, '24230': 12, '24224': 4, '24188': 16, '24172': 6, '24094': 4, '24077': 2, '24071': 2, '24064': 2, '24611': 2, '24612': 2, '24977': 2 },
    // Egen samling: signal- og tilslutningsspor (188,3 mm) tælles som lige 24188.
    mine: { '24188': 57, '24172': 37, '24077': 3, '24977': 2, '24130': 44, '24230': 12, '24330': 6, '24224': 3, '24611': 1, '24612': 2, '24671': 4, '24672': 4, '24630': 1, '24640': 1, '24649': 1 },
    large: { '24130': 16, '24115': 4, '24230': 16, '24215': 4, '24224': 12, '24206': 4, '24330': 12, '24360': 2, '24236': 4, '24188': 30, '24172': 16, '24094': 6, '24077': 4, '24071': 2, '24064': 2, '24611': 6, '24612': 6, '24977': 4 },
  };
  // Pladestørrelser inspireret af SCARMs Märklin C-skinne-planer
  const SIZES = [[100, 100, '1 m²'], [160, 100, ''], [205, 120, ''], [225, 105, ''], [300, 150, ''], [378, 244, ''], [450, 250, '']];
  // Stationsplacering som brøkdel af pladen (x fra venstre, y fra forkanten)
  const PLACES = [['Foran', .5, 0], ['Bagved', .5, 1], ['Venstre', 0, .5], ['Højre', 1, .5], ['Midt', .5, .5]];

  const state = { inv: {}, history: [], idx: -1, seedBase: (Date.now() & 0xffff) * 7919, place: { fx: .5, fy: 0 },
    topologies: { loop: true, dogbone: true, p2p: true, free: true }, elements: {}, areas: [], drawingArea: null };

  // ---------- persistens ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('marklin.' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('marklin.' + k, JSON.stringify(v)); } catch (e) { /* ignorer */ } },
  };
  const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('da-DK');

  // ---------- lagertabel ----------
  function buildInventory() {
    const groups = [
      ['Lige spor', p => p.kind === 'straight'],
      ['Kurver', p => p.kind === 'curve'],
      ['Sporskifter, krydsninger og andet', p => ['switch', 'switch3', 'cswitch', 'sswitch', 'dslip', 'crossing', 'buffer'].includes(p.kind)],
    ];
    const t = $('invTable'); t.innerHTML = '';
    for (const [title, f] of groups) {
      const tr = document.createElement('tr'); tr.className = 'grp'; tr.innerHTML = `<td colspan="2">${title}</td>`; t.appendChild(tr);
      for (const p of G.CATALOG.filter(f)) {
        const r = document.createElement('tr');
        r.innerHTML = `<td><span class="swatch" style="background:${catColor(p.art)}"></span><span class="art">${p.art}</span>
          <div class="desc">${p.name}</div></td>
          <td class="n"><input type="number" min="0" max="200" step="1" data-art="${p.art}" aria-label="Antal ${p.art}"></td>`;
        t.appendChild(r);
      }
    }
    t.addEventListener('input', e => {
      const a = e.target.dataset.art; if (!a) return;
      state.inv[a] = Math.max(0, parseInt(e.target.value, 10) || 0);
      store.set('inv', state.inv);
    });
  }
  /** Lageret læses altid fra felterne, så visning og beregning ikke kan komme ud af trit. */
  function readInventory() {
    const inv = {};
    document.querySelectorAll('#invTable input').forEach(i => inv[i.dataset.art] = Math.max(0, parseInt(i.value, 10) || 0));
    state.inv = inv;
    return inv;
  }
  function setInventory(inv) {
    inv = inv || {};
    state.inv = {};
    G.CATALOG.forEach(p => state.inv[p.art] = inv[p.art] || 0);
    document.querySelectorAll('#invTable input').forEach(i => i.value = state.inv[i.dataset.art]);
    store.set('inv', state.inv);
  }

  function buildRef() {
    const rows = G.CATALOG.map(p => {
      const dim = p.kind === 'curve' ? `${p.rn} = ${fmt(p.r)} mm · ${fmt(p.ang)}°`
        : p.kind === 'switch' ? `${fmt(p.len)} mm · gren R2 ${fmt(p.ang)}°`
        : p.kind === 'switch3' ? `${fmt(p.len)} mm · 2 grene R2 ${fmt(p.ang)}°`
        : p.kind === 'cswitch' ? `${p.r === 360 ? 'R1' : 'R3'} 30° · ydre spor ${fmt(p.off || 77.5)} mm forskudt*`
        : p.kind === 'sswitch' ? `${fmt(p.len)} mm · gren R ${fmt(p.r)} mm ${fmt(p.ang)}° · sporafstand 64,3 mm`
        : p.kind === 'dslip' ? `${fmt(p.len)} mm · ${fmt(p.ang)}° (mål som krydsning 24640)`
        : p.kind === 'crossing' ? `${fmt(p.len)} mm · ${fmt(p.ang)}°` : `${fmt(p.len)} mm`;
      return `<tr><td><span class="swatch" style="background:${catColor(p.art)}"></span>${p.art}</td><td>${dim}</td></tr>`;
    }).join('');
    $('refTable').innerHTML = `<tr><th>Art.nr.</th><th>Mål</th></tr>${rows}`;
  }

  // ---------- indstillinger ----------
  function settings() {
    const W = Math.max(600, (+$('bw').value || 200) * 10), H = Math.max(600, (+$('bh').value || 120) * 10);
    const margin = Math.max(25, +$('margin').value || 50);
    const st = +$('stTracks').value;
    const px = margin + state.place.fx * (W - 2 * margin), py = margin + state.place.fy * (H - 2 * margin);
    return {
      W, H, margin, sCurves: $('optS').checked, largeRadius: $('optLarge').checked,
      maximize: $('optMax').checked, allSwitches: $('optAllSw').checked,
      stationTracks: st, point: st ? { x: px, y: py } : null,
      topologies: Object.fromEntries(MK.topologies.map(t => [t.id, state.topologies[t.id] !== false])), elements: { ...state.elements },
      areas: state.areas.map(a => a.map(p => ({ x: p.x, y: p.y }))),
    };
  }
  function saveSettings() {
    store.set('settings2', {
      W: +$('bw').value, H: +$('bh').value, margin: +$('margin').value,
      sCurves: $('optS').checked, largeRadius: $('optLarge').checked, stationTracks: +$('stTracks').value,
      maximize: $('optMax').checked, allSwitches: $('optAllSw').checked,
      place: state.place, topologies: state.topologies, elements: state.elements, areas: state.areas,
    });
  }
  function loadSettings() {
    const s = store.get('settings2'); if (!s) return;
    if (s.W) $('bw').value = s.W; if (s.H) $('bh').value = s.H; if (s.margin) $('margin').value = s.margin;
    $('optS').checked = s.sCurves !== false; $('optLarge').checked = !!s.largeRadius;
    $('optMax').checked = s.maximize !== false;
    $('optAllSw').checked = !!s.allSwitches;
    if (s.stationTracks !== undefined) $('stTracks').value = String(s.stationTracks);
    if (s.place) state.place = s.place;
    if (s.topologies) state.topologies = { ...state.topologies, ...s.topologies };
    if (s.elements) state.elements = s.elements;
    if (Array.isArray(s.areas)) state.areas = s.areas.filter(a => Array.isArray(a) && a.length >= 3);
  }
  function buildStrategies() {
    $('topoList').innerHTML = MK.topologies.map(t => `<label class="check"><input type="checkbox" data-topo="${t.id}" ${state.topologies[t.id] !== false ? 'checked' : ''}><span>${t.name}<small>${t.desc}</small></span></label>`).join('');
    $('elemList').innerHTML = MK.elements.map(e => {
      const m = state.elements[e.id] || 'may';
      const opt = (v, t) => `<label><input type="radio" name="el-${e.id}" value="${v}" ${m === v ? 'checked' : ''}><span>${t}</span></label>`;
      return `<div class="el"><b>${e.name}</b><span class="tri" role="radiogroup" aria-label="${e.name}">${opt('off', 'Fra')}${opt('may', 'Kan')}${opt('must', 'Skal')}</span><small>${e.desc}</small></div>`;
    }).join('');
    $('topoList').addEventListener('change', e => {
      const id = e.target.dataset.topo; if (!id) return;
      state.topologies[id] = e.target.checked;
      if (!MK.topologies.some(t => state.topologies[t.id] !== false)) { state.topologies[id] = true; e.target.checked = true; }
      saveSettings();
    });
    $('elemList').addEventListener('change', e => {
      const m = e.target.name && e.target.name.match(/^el-(.+)$/); if (!m) return;
      state.elements[m[1]] = e.target.value; saveSettings();
    });
  }
  function syncUI() {
    document.querySelectorAll('#placeChips .chip').forEach(c => {
      c.classList.toggle('on', Math.abs(+c.dataset.fx - state.place.fx) < 1e-6 && Math.abs(+c.dataset.fy - state.place.fy) < 1e-6);
    });
  }

  // ---------- generering ----------
  // Løbende generering i en Web Worker: hver færdig bane sendes tilbage og lægges i listen, sorteret
  // efter point. Der er ingen samlet tidsgrænse – brugeren stopper selv. Falder tilbage til direkte kørsel.
  const RUN_MS = s => s.maximize || s.allSwitches ? 2500 : 900;     // tænketid pr. bane
  let worker = null, jobId = 0, timer = null, statusTimer = null, running = false, follow = true, errors = 0, t0 = 0;
  function newWorker() {
    try { return new Worker('js/worker.js?v=20261112-2112'); } catch (e) { return false; }
  }
  function stop(msg) {
    running = false; jobId++;
    if (worker) { worker.terminate(); worker = null; }
    clearTimeout(timer); clearTimeout(statusTimer);
    $('gen').textContent = 'Generér baner'; $('gen').classList.remove('running');
    if (msg) $('status').innerHTML = msg; else showStatus();
  }
  function start() {
    stop();
    const s = settings(); saveSettings();
    state.history = []; state.idx = -1; follow = true; errors = 0; t0 = Date.now();
    renderList(); $('stage').innerHTML = '<div class="empty">Genererer …</div>'; $('factsCard').hidden = true;
    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    const opts = { ...s, seed, avoid: [], timeBudget: RUN_MS(s) };
    const id = ++jobId;
    running = true;
    $('gen').textContent = 'Stop'; $('gen').classList.add('running');
    showStatus();
    const add = res => {
      if (id !== jobId) return;
      if (res.error) {
        if (++errors >= 4 && !state.history.length) stop(`<span class="warn">${res.error}</span>`);
        return;
      }
      errors = 0;
      state.history.push({ res, s, n: state.history.length + 1 });
      const bestI = bestIndex();
      if (follow && bestI !== state.idx) { state.idx = bestI; show(); }
      renderList(); showStatus();
    };
    worker = newWorker();
    if (!worker) {
      // uden worker: én bane ad gangen med pauser, så siden kan reagere
      let k = 0;
      const step = () => {
        if (id !== jobId) return;
        const topos = Object.keys(opts.topologies).filter(t => opts.topologies[t]);
        const tp = topos.length > 1 ? Object.fromEntries(Object.keys(opts.topologies).map(t => [t, t === topos[k % topos.length]])) : opts.topologies;
        add(MK.generate({ ...readInventory() }, { ...opts, topologies: tp, seed: (seed + k++ * 104729) >>> 0, avoid: state.history.slice(-60).map(h => h.res.sig) }));
        timer = setTimeout(step, 30);
      };
      timer = setTimeout(step, 20);
      return;
    }
    worker.onmessage = e => { if (e.data.id === id) add(e.data.result); };
    worker.onerror = () => stop('<span class="warn">Generatoren stoppede med en fejl.</span>');
    worker.postMessage({ id, inv: { ...readInventory() }, opts });
  }
  const generate = () => (running ? stop() : start());
  const byScore = () => state.history.map((h, i) => i).sort((a, b) => state.history[b].res.score - state.history[a].res.score);
  const bestIndex = () => byScore()[0];
  function showStatus() {
    const n = state.history.length;
    const secs = fmt((Date.now() - t0) / 1000, 0);
    if (running) $('status').textContent = `Genererer … ${n} bane${n === 1 ? '' : 'r'} på ${secs} s · tryk Stop når du har set nok`;
    else if (n) show(true);
    else $('status').innerHTML = 'Tryk <kbd>Generér baner</kbd> (eller mellemrum)';
    if (running) { clearTimeout(statusTimer); statusTimer = setTimeout(showStatus, 1000); }
  }
  function miniSVG(res, s) {
    const Y = y => s.H - y;
    const P = pts => pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(0) + ' ' + Y(p.y).toFixed(0)).join('');
    const paths = [...res.chains.map(c => c.samples), ...res.sides.map(sd => sd.pts)].filter(p => p && p.length);
    return `<svg viewBox="0 0 ${s.W} ${s.H}" preserveAspectRatio="xMidYMid meet"><rect width="${s.W}" height="${s.H}" fill="${COL.board}"/>` +
      paths.map(p => `<path d="${P(p)}" fill="none" stroke="#3b3b3b" stroke-width="${Math.max(s.W, s.H) / 90}"/>`).join('') + '</svg>';
  }
  function renderList() {
    const el = $('results');
    if (!state.history.length) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    // de 60 bedste vises (plus den valgte, hvis den ligger længere nede)
    const order = byScore(), top = order.slice(0, 60);
    if (state.idx >= 0 && !top.includes(state.idx)) top.push(state.idx);
    el.innerHTML = top.map(i => {
      const { res, s, n } = state.history[i];
      return `<button class="thumb${i === state.idx ? ' on' : ''}" data-i="${i}" title="${res.stats.name} · ${Math.round(res.score)} point">
        ${miniSVG(res, s)}<span><b>${Math.round(res.score)}</b> · nr. ${n}</span></button>`;
    }).join('');
  }
  $('results').addEventListener('click', e => {
    const b = e.target.closest('.thumb'); if (!b) return;
    follow = false; state.idx = +b.dataset.i; show(); renderList();
  });

  function show(statusOnly) {
    const h = state.history[state.idx]; if (!h) return;
    const { res, s } = h;
    const order = byScore(), pos = order.indexOf(state.idx);
    if (!statusOnly) {
      $('stage').innerHTML = renderSVG(res, s);
      bindStage(s);
      renderFacts(res, s);
      renderParts(res);
    }
    $('prev').disabled = pos <= 0;
    $('next').disabled = pos >= order.length - 1;
    if (running) return;
    let msg = `Bane nr. ${h.n} · nr. ${pos + 1} af ${order.length} efter point (${Math.round(res.score)}) · ${res.stats.piecesUsed} af ${res.stats.piecesTotal} skinner brugt`;
    const st = res.station;
    if (res.missing && res.missing.length) msg += ` · Kunne ikke placere: ${res.missing.join(', ')}`;
    if (s.allSwitches && res.stats.switchesUsed < res.stats.switchesTotal) msg += ` · Kun ${res.stats.switchesUsed} af ${res.stats.switchesTotal} sporskifter kunne placeres – prøv længere tænketid eller større plade`;
    if (st && st.tracks < st.want) {
      msg += st.tracks
        ? ` · Station: kun ${st.tracks} af ${st.want} ekstra spor kunne placeres`
        : ' · Station kunne ikke placeres (kræver 1× 24611 + 1× 24612 + 2× 24224 og mindst 2× 24188 + 2× 24172 i en lige strækning pr. spor)';
    }
    $('status').textContent = msg;
  }

  // ---------- SVG ----------
  function renderSVG(res, s) {
    const W = s.W, H = s.H, fs = Math.max(30, Math.max(W, H) / 70), pad = fs * 2.4;
    const Y = y => H - y;
    const P = pts => pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + Y(p.y).toFixed(1)).join('');
    const off = (pts, d) => pts.map(p => ({ x: p.x + d * Math.cos((p.h + 90) * Math.PI / 180), y: p.y + d * Math.sin((p.h + 90) * Math.PI / 180) }));
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}" font-family="system-ui, sans-serif">`);
    out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${COL.board}" stroke="${COL.boardEdge}" stroke-width="6" rx="4"/>`);
    const gl = [];
    for (let x = 100; x < W; x += 100) gl.push(`M${x} 0V${H}`);
    for (let y = 100; y < H; y += 100) gl.push(`M0 ${Y(y)}H${W}`);
    out.push(`<path d="${gl.join('')}" stroke="${COL.grid}" stroke-width="2"/>`);
    const areaPath = pts => pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + Y(p.y).toFixed(1)).join('') + 'Z';
    for (const area of s.areas || []) out.push(`<path class="avoid-area" d="${areaPath(area)}"/>`);
    if (state.drawingArea && state.drawingArea.length) out.push(`<path class="avoid-area" opacity=".65" d="${areaPath(state.drawingArea)}"/>`);
    for (let x = 0; x <= W; x += (W > 2500 ? 500 : 200)) out.push(`<text x="${x}" y="${-fs * 0.7}" font-size="${fs}" fill="${COL.gridTxt}" text-anchor="middle">${x / 10}</text>`);
    for (let y = 0; y <= H; y += (H > 2500 ? 500 : 200)) out.push(`<text x="${-fs * 0.6}" y="${Y(y) + fs / 3}" font-size="${fs}" fill="${COL.gridTxt}" text-anchor="end">${y / 10}</text>`);
    out.push(`<text x="0" y="${H + fs * 1.6}" font-size="${fs * 0.9}" fill="${COL.gridTxt}">▼ Forkant</text>`);
    out.push(`<text x="${W}" y="${H + fs * 1.6}" font-size="${fs * 0.9}" fill="${COL.gridTxt}" text-anchor="end">${W / 10} × ${H / 10} cm · gitter 10 cm</text>`);

    const draw = (p, extra = '') => {
      const c = G.BY_ART[p.art];
      const paths = [p.pts, ...(p.branchPtsList || [])];
      const col = catColor(p.art);
      let g = `<g class="pc" data-art="${p.art}" data-tip="${c.art} – ${c.name}${extra}">`;
      for (const pts of paths) g += `<path class="bed" d="${P(pts)}" fill="none" stroke="${col}" stroke-width="40"/>`;
      for (const pts of paths) g += `<path d="${P(pts)}" fill="none" stroke="${COL.sleeper}" stroke-width="28" stroke-dasharray="3.5 5.5"/>`;
      for (const pts of paths) for (const d of [-8.25, 8.25]) g += `<path d="${P(off(pts, d))}" fill="none" stroke="${COL.rail}" stroke-width="2"/>`;
      const a = p.pts[0], n = { x: Math.cos((a.h + 90) * Math.PI / 180), y: Math.sin((a.h + 90) * Math.PI / 180) };
      g += `<line x1="${(a.x + n.x * 21).toFixed(1)}" y1="${Y(a.y + n.y * 21).toFixed(1)}" x2="${(a.x - n.x * 21).toFixed(1)}" y2="${Y(a.y - n.y * 21).toFixed(1)}" stroke="${COL.joint}" stroke-width="2"/>`;
      if (p.buffer) {
        const e = p.pts[p.pts.length - 1];
        g += `<line x1="${(e.x + n.x * 18).toFixed(1)}" y1="${Y(e.y + n.y * 18).toFixed(1)}" x2="${(e.x - n.x * 18).toFixed(1)}" y2="${Y(e.y - n.y * 18).toFixed(1)}" stroke="#d33" stroke-width="9"/>`;
      }
      return g + '</g>';
    };
    const label = { ring: ' (ydre ring)', station: ' (stationsspor)', blindspor: ' (blindspor)', cutoff: ' (vendeforbindelse)', wye: ' (trekantspor)', stub: ' (stikspor til vendesløjfe)' };
    for (const sd of res.sides) for (const p of sd.pieces) if (!p.virtual) out.push(draw(p, label[sd.type] || ''));
    for (const ch of res.chains) for (const p of ch.pieces) if (!p.virtual || ['crossing', 'dslip'].includes(G.BY_ART[p.art].kind)) out.push(draw(p, ch.kind === 'ring' ? label.ring : ch.kind === 'balloon' ? ' (vendesløjfe)' : ch.kind === 'extra' ? ' (ekstra sløjfe)' : ch.kind === 'link' ? ' (forbindelse)' : ''));

    // stationsnavn og valgt punkt
    if (res.station && res.station.center) {
      const c = res.station.center;
      out.push(`<g pointer-events="none"><rect x="${c.x - fs * 2.6}" y="${Y(c.y) - fs * 0.75}" width="${fs * 5.2}" height="${fs * 1.5}" rx="${fs * 0.3}" fill="rgba(255,255,255,.85)" stroke="#333" stroke-width="2"/>
        <text x="${c.x}" y="${Y(c.y) + fs * 0.33}" font-size="${fs * 0.95}" text-anchor="middle" font-weight="700" fill="#222">Station</text></g>`);
    }
    if (res.point) {
      const p = res.point, r = fs * 0.55;
      out.push(`<g pointer-events="none" opacity=".9"><circle cx="${p.x}" cy="${Y(p.y)}" r="${r}" fill="none" stroke="${COL.pin}" stroke-width="5"/>
        <path d="M${p.x - r * 1.8} ${Y(p.y)}H${p.x - r * 0.5}M${p.x + r * 0.5} ${Y(p.y)}H${p.x + r * 1.8}M${p.x} ${Y(p.y) - r * 1.8}V${Y(p.y) - r * 0.5}M${p.x} ${Y(p.y) + r * 0.5}V${Y(p.y) + r * 1.8}" stroke="${COL.pin}" stroke-width="5"/></g>`);
    }
    out.push('</svg>');
    return out.join('');
  }

  function bindStage(s) {
    const tip = $('tip');
    const svg = $('stage').querySelector('svg');
    svg.addEventListener('mousemove', e => {
      const g = e.target.closest('g.pc');
      if (!g) { tip.style.opacity = 0; return; }
      tip.textContent = g.dataset.tip;
      tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; tip.style.opacity = 1;
    });
    svg.addEventListener('mouseleave', () => tip.style.opacity = 0);
    // klik på pladen = ny stationsplacering
    svg.addEventListener('click', e => {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const q = pt.matrixTransform(svg.getScreenCTM().inverse());
      const x = q.x, y = s.H - q.y;
      if (x < 0 || y < 0 || x > s.W || y > s.H) return;
      if (state.drawingArea) {
        const last = state.drawingArea[state.drawingArea.length - 1];
        if (!last || Math.hypot(last.x - x, last.y - y) > 8) state.drawingArea.push({ x, y });
        show();
        return;
      }
      const clamp = v => Math.max(0, Math.min(1, v));
      state.place = { fx: clamp((x - s.margin) / (s.W - 2 * s.margin)), fy: clamp((y - s.margin) / (s.H - 2 * s.margin)) };
      if (+$('stTracks').value === 0) $('stTracks').value = '1';
      syncUI(); start();
    });
    svg.addEventListener('dblclick', e => {
      if (!state.drawingArea) return;
      e.preventDefault();
      const area = state.drawingArea;
      state.drawingArea = null;
      if (area.length >= 3) state.areas.push(area);
      saveSettings(); updateAreaControls(); show();
    });
  }

  function updateAreaControls() {
    const drawing = !!state.drawingArea;
    $('drawArea').textContent = drawing ? 'Annuller tegning' : 'Tegn forbudsområde';
    $('finishArea').hidden = !drawing;
    $('clearAreas').hidden = !state.areas.length;
    $('areaHint').hidden = !drawing;
    $('stage').classList.toggle('drawing', drawing);
  }
  $('drawArea').addEventListener('click', () => {
    state.drawingArea = state.drawingArea ? null : [];
    updateAreaControls();
    if (state.history[state.idx]) show();
    else {
      const s = settings();
      $('stage').innerHTML = renderSVG({ chains: [], sides: [] }, { ...s, areas: state.areas });
      bindStage(s);
    }
  });
  $('finishArea').addEventListener('click', () => {
    if (!state.drawingArea) return;
    const added = state.drawingArea.length >= 3;
    if (added) state.areas.push(state.drawingArea);
    state.drawingArea = null; saveSettings(); updateAreaControls();
    if (state.history[state.idx]) { show(); start(); }
    else if (added) start();
  });
  $('clearAreas').addEventListener('click', () => {
    state.areas = []; state.drawingArea = null; saveSettings(); updateAreaControls();
    if (state.history[state.idx]) { show(); start(); }
  });

  function renderFacts(res, s) {
    const st = res.stats;
    const line = [st.double ? 'Dobbelt' : st.topo === 'dogbone' ? 'Foldet (to parallelle spor)' : 'Enkelt'];
    if (st.crossovers) line.push(`${st.crossovers} sporforbindelse${st.crossovers > 1 ? 'r' : ''}`);
    if (st.sidings) line.push(`${st.sidings} blindspor`);
    const total = Object.values(res.used).reduce((a, n) => a + n, 0);
    const facts = [
      ['Pladens mål', `${s.W / 10} × ${s.H / 10} cm`],
      ['Areal', `${fmt(s.W * s.H / 1e6, 2)} m²`],
      ['Sporets udstrækning', `${fmt(st.bbox.w / 10, 0)} × ${fmt(st.bbox.h / 10, 0)} cm`],
      ['Type', st.topo === 'p2p' ? 'Punkt-til-punkt' : 'Lukket rute'],
      ['Vending uden at bakke', st.reverseLoops > 1 ? 'Begge køreretninger' : st.reverseLoops ? 'Én køreretning' : '–'],
      ['Uafhængige ruter', String(st.routes || 1)],
      ['Linje', line.join(', ')],
      ['Station', res.station && res.station.tracks ? `${res.station.tracks + 1} spor` + (res.station.usable ? ` · ${fmt(res.station.usable / 10, 0)} cm lige perronspor` : '') : '–'],
      ['Hovedspor', `${fmt(st.length / 1000, 2)} m` + (st.double ? ` + ${fmt(st.outerLength / 1000, 2)} m` : '')],
      ['Radier', st.radii.join(', ')],
      ['Sporskifter brugt', `${st.switchesUsed} af ${st.switchesTotal}` + (st.rough ? ` · ${st.rough} blindspor uden 24224/prelbuk` : '')],
      ['Skinner brugt', `${st.piecesUsed} af ${st.piecesTotal} (${Math.round(100 * st.piecesUsed / Math.max(1, st.piecesTotal))} %)`],
      ['Point', scoreText(res)],
    ];
    $('factsTitle').textContent = st.name;
    $('facts').innerHTML = facts.map(([k, v]) => `<div><b>${k}</b><span>${v}</span></div>`).join('') +
      `<div style="grid-column:1/-1"><b>Strategier i denne bane</b><span class="tags">${res.strategies.map(x => `<span class="tag">${x.name}${x.n > 1 ? ' ×' + x.n : ''}</span>`).join('')}</span></div>`;
    $('factsCard').hidden = false;
  }

  const SCORE_NAMES = { missing: 'mangler', deadEnds: 'blindspor', switches: 'ubrugte sporskifter', reverse: 'vendemulighed', routes: 'ruter', trap: 'fælder', ring: 'ring', crossover: 'forbindelser', station: 'stationer', compact: 'kompakt', density: 'tæthed', pieces: 'skinner' };
  function scoreText(res) {
    const p = res.scoreParts || {};
    const bits = Object.keys(SCORE_NAMES).filter(k => Math.round(p[k] || 0)).map(k => `${SCORE_NAMES[k]} ${p[k] > 0 ? '+' : ''}${Math.round(p[k])}`);
    return `<b>${Math.round(res.score || 0)}</b>` + (bits.length ? ` <small>(${bits.join(', ')})</small>` : '');
  }
  function renderParts(res) {
    const rows = G.CATALOG.filter(p => (res.used[p.art] || 0) > 0 || (state.inv[p.art] || 0) > 0).map(p => {
      const u = res.used[p.art] || 0, a = state.inv[p.art] || 0;
      return `<tr data-art="${p.art}"><td><span class="swatch" style="background:${catColor(p.art)}"></span>${p.art}</td>
        <td>${p.name}</td><td class="num ${u ? '' : 'zero'}">${u}</td><td class="num zero">${a - u}</td></tr>`;
    }).join('');
    $('parts').innerHTML = `<tr><th>Art.nr.</th><th>Beskrivelse</th><th class="num">Brugt</th><th class="num">Tilovers</th></tr>${rows}`;
  }

  $('parts').addEventListener('mouseover', e => {
    const tr = e.target.closest('tr[data-art]');
    document.querySelectorAll('g.pc.hl').forEach(g => g.classList.remove('hl'));
    if (tr) document.querySelectorAll(`g.pc[data-art="${tr.dataset.art}"]`).forEach(g => g.classList.add('hl'));
  });
  $('parts').addEventListener('mouseleave', () => document.querySelectorAll('g.pc.hl').forEach(g => g.classList.remove('hl')));

  // ---------- events ----------
  $('gen').onclick = generate;
  const step = d => { const o = byScore(), p = o.indexOf(state.idx) + d; if (p >= 0 && p < o.length) { follow = false; state.idx = o[p]; show(); renderList(); } };
  $('prev').onclick = () => step(-1);
  $('next').onclick = () => step(1);
  $('print').onclick = () => window.print();
  $('dl').onclick = () => {
    const svg = $('stage').querySelector('svg'); if (!svg) return;
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg.outerHTML], { type: 'image/svg+xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `marklin-bane-${state.idx + 1}.svg`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('preset').onchange = e => {
    const v = e.target.value; if (!v) return;
    setInventory(v === 'zero' ? {} : PRESETS[v] || {});
    e.target.value = '';
  };
  ['bw', 'bh', 'margin', 'optS', 'optLarge', 'stTracks', 'optMax', 'optAllSw'].forEach(id => $(id).addEventListener('change', saveSettings));
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); generate(); }
    if (e.key === 'ArrowLeft') $('prev').click();
    if (e.key === 'ArrowRight') $('next').click();
  });

  // ---------- init ----------
  $('sizeChips').innerHTML = SIZES.map(([w, h, t]) => `<button class="chip" data-w="${w}" data-h="${h}">${w}×${h}${t ? ' · ' + t : ''}</button>`).join('');
  $('sizeChips').onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return;
    $('bw').value = b.dataset.w; $('bh').value = b.dataset.h; saveSettings(); start();
  };
  $('placeChips').innerHTML = PLACES.map(([t, fx, fy]) => `<button class="chip" data-fx="${fx}" data-fy="${fy}">${t}</button>`).join('');
  $('placeChips').onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.place = { fx: +b.dataset.fx, fy: +b.dataset.fy };
    if (+$('stTracks').value === 0) $('stTracks').value = '1';
    syncUI(); saveSettings(); start();
  };
  buildInventory(); buildRef(); loadSettings(); buildStrategies(); syncUI(); updateAreaControls();
  setInventory(store.get('inv') || PRESETS.medium);
  $('prev').disabled = $('next').disabled = true;
  // ingen automatisk generering ved indlæsning – brugeren trykker selv
})();
