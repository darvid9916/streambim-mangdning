/* Mängdning – StreamBIM-widget (endast läsning)
 * Flöde: läs in objekten en gång → 1. disciplin → 2. objekttyp → 3. parametrar.
 * Varje steg visar bara det som finns kvar efter tidigare val (räknat från verklig data).
 * Söksyntaxen för IFC-klass provas fram automatiskt. Widgeten skriver aldrig till modell eller projekt,
 * den ändrar bara vyn (färg, sökning, dolda objekt, lager) och "Återställ vy" nollställer den.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const S = {
    settings: null, api: null, projectId: '', projectName: '', buildingId: '', email: '',
    variant: null, objects: [], disc: { mode: null, key: null, label: '' }, layersOrig: null, layersChanged: false,
    selDisc: new Set(), selKinds: new Set(), filters: [], picked: new Set(),
    groups: [], total: null, cur: [], mode: 'mark', selectedRow: null, hidden: false
  };
  const QTY = ['length', 'area', 'volume'];
  const QNAME = { length: 'Längd', area: 'Area', volume: 'Volym' };
  const MISSING = '(saknas)';

  // ---------- hjälpfunktioner ----------
  async function loadJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw { code: 'CONFIG_LOAD_FAILED', detail: url + ' ' + r.status };
    return r.json();
  }
  function showError(e) {
    const el = $('error');
    el.textContent = typeof e === 'string' ? e
      : ((e && (e.code || e.message)) || 'Fel') + (e && e.detail ? ' – ' + JSON.stringify(e.detail) : '');
    el.hidden = false;
    console.error(e);
    debug('FEL', e && e.stack ? e.stack : e);
  }
  const clearError = () => { $('error').hidden = true; };
  const first = v => Array.isArray(v) ? v[0] : v;
  const lastSeg = v => (typeof v === 'string' && v.includes('~')) ? v.split('~').pop() : v;
  const str = v => (v === undefined || v === null) ? '' : String(v);
  const splitKey = k => { const i = k.indexOf('~'); return i < 0 ? { pset: null, key: k } : { pset: k.slice(0, i), key: k.slice(i + 1) }; };
  const norm = k => String(k).replace(/^ifc/i, '').toLowerCase();
  const fmt = (n, d = 2) => n.toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const byText = (a, b) => String(a).localeCompare(String(b), 'sv', { numeric: true });

  // Svarsformaten är odokumenterade: tål lista, {values:[...]}, {värde: antal} m.m.
  function toValueList(res) {
    if (Array.isArray(res)) return res.map(v => (v && typeof v === 'object') ? (v.value ?? v.name ?? v.key ?? v.propValue ?? JSON.stringify(v)) : v);
    if (res && typeof res === 'object') {
      for (const k of ['values', 'data', 'result', 'results', 'items']) if (Array.isArray(res[k])) return toValueList(res[k]);
      const vals = Object.values(res);
      if (vals.length && vals.every(v => typeof v === 'string')) return vals;
      return Object.keys(res);
    }
    if (typeof res === 'string') return res ? [res] : [];
    return [];
  }
  function toObjectList(res) {
    if (Array.isArray(res)) return res;
    if (res && typeof res === 'object') {
      for (const k of ['objects', 'values', 'data', 'result', 'results', 'items']) if (Array.isArray(res[k])) return res[k];
      return Object.values(res).filter(x => x && typeof x === 'object');
    }
    return [];
  }
  function debug(label, data) {
    if (!S.settings || !S.settings.debug) return;
    let pre = document.getElementById('debug');
    if (!pre) {
      pre = document.createElement('pre'); pre.id = 'debug';
      pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;font-size:11px;background:#111;color:#9fe;padding:8px;border-radius:6px;user-select:text;';
      const btn = document.createElement('button'); btn.textContent = 'Kopiera felsökning'; btn.className = 'ghost wide';
      btn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(pre.textContent); btn.textContent = 'Kopierat!'; }
        catch (_) { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); btn.textContent = 'Markerat – tryck Ctrl+C'; }
        setTimeout(() => { btn.textContent = 'Kopiera felsökning'; }, 2500);
      });
      document.getElementById('app').append(btn, pre);
    }
    let txt; try { txt = JSON.stringify(data); } catch (_) { txt = String(data); }
    pre.textContent += `${label} (${Array.isArray(data) ? 'array' : typeof data}): ${String(txt).slice(0, 1500)}\n\n`;
    console.info('[debug]', label, data);
  }
  function toNum(v) {
    v = first(v);
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v === undefined || v === null) return null;
    const n = parseFloat(String(lastSeg(v)).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  function setProgress(txt) { $('progress').hidden = !txt; if (txt) $('progressTxt').textContent = txt; }
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function option(sel, value, label) { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); }
  const canon = k => S.settings.classes.find(c => norm(c) === norm(k)) || String(k).replace(/^ifc/i, '');
  const kindLabel = k => 'Ifc' + canon(k);
  const keyLabel = k => {
    if (k === '@kind') return 'IFC-klass';
    if (k === '@disc') return 'Disciplin';
    if (k.startsWith('@')) return k.slice(1);
    const s = splitKey(k); return s.pset ? `${s.key} (${s.pset})` : s.key;
  };

  // Egenskaper platt: "Pset~Nyckel" → text. Klarar både platt och nästlat format.
  function flatten(info) {
    const out = {};
    Object.entries(info.properties || {}).forEach(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.entries(v).forEach(([kk, vv]) => { out[k + '~' + kk] = str(lastSeg(first(vv))); });
      else out[k] = str(lastSeg(first(v)));
    });
    Object.entries(info).forEach(([k, v]) => {
      if (['properties', 'center', 'guid', 'id'].includes(k)) return;
      if (typeof v === 'string' || typeof v === 'number') out['@' + k] = String(v);
    });
    return out;
  }
  const guidOf = (i, f) => i.guid || i.id || i.globalId || f.GUID || f.GlobalId || f['@globalId'];
  const nameOf = (i, f) => i.name || f.Name || f['@name'] || guidOf(i, f);

  function quantities(info, kind) {
    const Q = S.settings.quantities, re = new RegExp(Q.psetPattern), idx = {};
    Object.entries(info.properties || {}).forEach(([k, v]) => {
      const s = splitKey(k);
      if (s.pset && re.test(s.pset)) { const n = toNum(v); if (n !== null && idx[s.key] === undefined) idx[s.key] = n; }
      else if (!s.pset && re.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
        Object.entries(v).forEach(([kk, vv]) => { const n = toNum(vv); if (n !== null && idx[kk] === undefined) idx[kk] = n; });
      }
    });
    const cls = Object.keys(Q.byClass).find(c => norm(c) === norm(kind));
    const out = { length: null, area: null, volume: null, src: [] };
    QTY.forEach(t => {
      const cands = (cls && Q.byClass[cls][t]) || Q.default[t];
      for (const c of cands) if (idx[c] !== undefined) { out[t] = idx[c] * (Q.scale[t] || 1); out.src.push(`${QNAME[t]}=${c}`); break; }
    });
    return out;
  }

  // ---------- söksyntax för IFC-klass: provas fram ----------
  function kindQuery(kind, limit, skip) {
    const v = S.variant, r = { buildingId: v.bid, propKey: S.settings.search.kindKey, propValue: v.vf(kind) };
    if (v.op) r.operator = v.op;
    return { filter: { rules: [[r]] }, page: { limit, skip } };
  }
  async function findVariant(kinds) {
    const bids = [...new Set([S.buildingId, String(S.buildingId)].concat(isNaN(+S.buildingId) ? [] : [+S.buildingId]))];
    const vfs = [
      { name: 'rått värde', f: k => String(k) },
      { name: 'utan Ifc', f: k => canon(k) },
      { name: 'IfcXxx', f: k => 'Ifc' + canon(k) },
      { name: 'IFCXXX', f: k => ('IFC' + canon(k)).toUpperCase() }
    ];
    const tried = [], errs = [];
    for (const k of kinds.slice(0, 4)) {
      const seen = new Set();
      for (const vf of vfs) {
        const val = vf.f(k); if (seen.has(val)) continue; seen.add(val);
        for (const op of [null, '=']) for (const bid of bids) {
          S.variant = { vf: vf.f, op, bid, name: vf.name };
          let res = [];
          try { res = toObjectList(await S.api.getObjectInfoForSearch(kindQuery(k, 3, 0))); } catch (e) { res = []; if (errs.length < 3) errs.push(e); }
          tried.push(`${val} op=${op} bid=${typeof bid}:${res.length}`);
          if (res.length) { debug('Söksyntax hittad', { klass: k, värde: val, operator: op, buildingId: bid, försök: tried.length }); debug('Första objektet (rått)', res[0]); return true; }
        }
      }
    }
    debug('getObjectInfoForSearch gav inga träffar', { försök: tried, fel: errs });

    // Reserv 1: findObjects / applyObjectSearch ger GUID:er, info hämtas sedan per objekt
    const k0 = kinds.slice(0, 2);
    for (const k of k0) {
      const seen = new Set();
      for (const vf of vfs) {
        const val = vf.f(k); if (seen.has(val)) continue; seen.add(val);
        try {
          const raw = await S.api.findObjects({ key: S.settings.search.kindKey, value: val, limit: 5 });
          const g = guidList(raw);
          tried.push(`findObjects ${val}:${g.length}`);
          if (g.length) { S.variant = { mode: 'find', vf: vf.f, op: null, bid: S.buildingId, name: 'findObjects ' + vf.name }; debug('Sökväg hittad: findObjects', { klass: k, värde: val, svar: raw }); return true; }
        } catch (e) { tried.push(`findObjects ${val}: FEL ${JSON.stringify(e)}`); }
        for (const op of [null, '=']) for (const bid of bids) {
          S.variant = { mode: 'apply', vf: vf.f, op, bid, name: 'applyObjectSearch ' + vf.name };
          try {
            const raw = await S.api.applyObjectSearch(kindQuery(k, 5, 0), true);
            const g = guidList(raw);
            tried.push(`applyObjectSearch ${val} op=${op} bid=${typeof bid}:${g.length}`);
            if (g.length) { await S.api.resetObjectSearch().catch(() => {}); debug('Sökväg hittad: applyObjectSearch', { klass: k, värde: val, operator: op, buildingId: bid, svar: raw }); return true; }
          } catch (e) { tried.push(`applyObjectSearch ${val}: FEL ${JSON.stringify(e)}`); }
        }
      }
    }
    S.api.resetObjectSearch().catch(() => {});

    // Diagnos: vad svarar övriga sökvägar?
    try { debug('quickSearch IfcWall', await S.api.quickSearch('IfcWall')); } catch (e) { debug('quickSearch FEL', e); }
    try {
      const raw = await S.api.makeApiRequest({ url: `/pgw/project-${S.projectId}/api/v1/ifc-searches`, method: 'POST',
        body: { rules: [[{ buildingId: S.buildingId, propKey: S.settings.search.kindKey, propValue: String(kinds[0]) }]] } });
      debug('REST ifc-searches', raw);
    } catch (e) { debug('REST ifc-searches FEL', e); }
    S.variant = null;
    debug('Ingen sökväg fungerade', tried);
    return false;
  }

  function guidList(res) {
    if (typeof res === 'string') { try { res = JSON.parse(res); } catch (_) { return res ? [res] : []; } }
    const arr = Array.isArray(res) ? res : toObjectList(res).length ? toObjectList(res) : (res && typeof res === 'object' ? Object.keys(res) : []);
    return arr.map(x => (x && typeof x === 'object') ? (x.guid || x.id || x.globalId) : x).filter(Boolean).map(String);
  }

  // Hämtar en sida objekt för en klass med den sökväg som fungerade
  async function fetchKind(kind, limit, skip) {
    const api = S.api, v = S.variant;
    if (!v.mode) return toObjectList(await api.getObjectInfoForSearch(kindQuery(kind, limit, skip)));
    S.guidCache = S.guidCache || {};
    if (!S.guidCache[kind]) {
      const max = S.settings.search.maxObjects;
      S.guidCache[kind] = v.mode === 'find'
        ? guidList(await api.findObjects({ key: S.settings.search.kindKey, value: v.vf(kind), limit: max }))
        : guidList(await api.applyObjectSearch(kindQuery(kind, max, 0), true));
    }
    const slice = S.guidCache[kind].slice(skip, skip + limit), out = [];
    for (let i = 0; i < slice.length; i += 25) {
      const part = await Promise.all(slice.slice(i, i + 25).map(g => api.getObjectInfo(g).then(info => {
        if (info && typeof info === 'object' && !info.guid) info.guid = g;
        return info;
      }).catch(() => null)));
      part.forEach(x => { if (x) out.push(x); });
      setProgress(`Läser in ${kindLabel(kind)}… ${(S.objects.length + out.length).toLocaleString('sv-SE')} objekt hittills`);
    }
    return out;
  }

  // ---------- inläsning ----------
  async function loadModel() {
    clearError();
    const api = S.api, { pageSize, maxObjects } = S.settings.search;
    S.objects = []; S.selDisc.clear(); S.selKinds.clear(); S.filters = [];
    ['discCard', 'classCard', 'filterCard', 'optCard', 'resultCard'].forEach(id => { $(id).hidden = true; });
    $('reloadBtn').disabled = true;
    try {
      setProgress('Läser vilka objekttyper som finns…');
      let present = [];
      try { const raw = await api.valuesForObjectProperty(S.settings.search.kindKey); debug('valuesForObjectProperty @kind', raw); present = toValueList(raw).map(v => str(lastSeg(v))).filter(Boolean); } catch (e) { debug('valuesForObjectProperty @kind FEL', e); }
      const excl = new Set(S.settings.excludeKinds.map(norm));
      let kinds = present.filter(k => !excl.has(norm(k)));
      if (!kinds.length) kinds = S.settings.classes.slice();
      // vanliga klasser först, så hittas söksyntaxen snabbt
      const common = ['wall', 'door', 'slab', 'window', 'beam', 'column'];
      kinds.sort((a, b) => ((common.indexOf(norm(a)) + 1 || 99) - (common.indexOf(norm(b)) + 1 || 99)) || byText(a, b));
      kinds = [...new Map(kinds.map(k => [norm(k), k])).values()];

      setProgress('Provar söksyntax mot modellen…');
      if (!await findVariant(kinds)) {
        throw 'Hittade inga objekt i modellen med någon av sökvägarna. Skicka texten i den mörka rutan längst ner (knappen "Kopiera felsökning").';
      }

      let truncated = false;
      for (const kind of kinds) {
        let skip = 0;
        for (;;) {
          setProgress(`Läser in ${kindLabel(kind)}… ${S.objects.length.toLocaleString('sv-SE')} objekt hittills`);
          let page = [];
          try { page = await fetchKind(kind, pageSize, skip); } catch (e) { debug('Sökfel ' + kind, e); page = []; }
          page.forEach(i => {
            const f = flatten(i), g = guidOf(i, f);
            if (g) S.objects.push({ guid: g, name: nameOf(i, f), kind: canon(kind), label: kindLabel(kind), props: f, q: quantities(i, kind), disc: '' });
          });
          if (S.objects.length >= maxObjects) { truncated = true; break; }
          if (page.length < pageSize) break;
          skip += pageSize;
        }
        if (truncated) break;
      }
      if (S.variant.mode === 'apply') await api.resetObjectSearch().catch(() => {});
      S.guidCache = {};
      const seen = new Set();
      S.objects = S.objects.filter(o => !seen.has(o.guid) && seen.add(o.guid));
      S.truncated = truncated;
      debug('Inlästa objekt', { antal: S.objects.length, perKlass: countBy(S.objects, o => o.label) });
      if (!S.objects.length) throw 'Modellen gav inga objekt för de valda objekttyperna.';

      setProgress('Avgör discipliner…');
      await detectDiscipline();
      ['discCard', 'classCard', 'filterCard', 'optCard'].forEach(id => { $(id).hidden = false; });
      update();
    } catch (e) { showError(e); }
    finally { setProgress(''); $('reloadBtn').disabled = false; }
  }

  function countBy(list, fn) { const m = {}; list.forEach(o => { const k = fn(o); m[k] = (m[k] || 0) + 1; }); return m; }

  async function detectDiscipline() {
    const D = S.settings.discipline;
    let layerNames = [];
    try {
      const raw = await S.api.getLayers();
      debug('getLayers', raw);
      if (Array.isArray(raw)) layerNames = raw.map(x => (x && typeof x === 'object') ? str(x.name ?? x.id) : str(x));
      else if (raw && typeof raw === 'object') { layerNames = Object.keys(raw); S.layersOrig = raw; }
    } catch (e) { debug('getLayers FEL', e); }
    const n = S.objects.length;
    // 1) en egenskap vars värden är lagernamn
    if (layerNames.length) {
      const L = new Set(layerNames), cnt = {};
      S.objects.forEach(o => Object.entries(o.props).forEach(([k, v]) => { if (L.has(v)) cnt[k] = (cnt[k] || 0) + 1; }));
      const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= n * 0.5) { S.disc = { mode: 'layers', key: best[0], label: `från lager (egenskapen ${keyLabel(best[0])})` }; }
    }
    // 2) en känd disciplinegenskap
    if (!S.disc.mode) {
      const keys = new Set(); S.objects.slice(0, 500).forEach(o => Object.keys(o.props).forEach(k => keys.add(k)));
      for (const c of D.keys) {
        const k = [...keys].find(x => x === c || x === '@' + c || x.endsWith('~' + c));
        if (k && S.objects.filter(o => o.props[k]).length >= n * 0.5) { S.disc = { mode: 'property', key: k, label: `från egenskapen ${keyLabel(k)}` }; break; }
      }
    }
    if (S.disc.mode) S.objects.forEach(o => { o.disc = o.props[S.disc.key] || MISSING; });
    else {
      // 3) uppskattad från IFC-klass
      S.disc = { mode: 'class', key: null, label: 'uppskattad från IFC-klass (ingen disciplinegenskap hittades i modellen)' };
      S.objects.forEach(o => {
        const hit = Object.entries(D.byClass).find(([, ks]) => ks.some(k => norm(k) === norm(o.kind)));
        o.disc = hit ? hit[0] : 'Övrigt';
      });
    }
    debug('Disciplin', { läge: S.disc.mode, nyckel: S.disc.key, lager: layerNames, fördelning: countBy(S.objects, o => o.disc) });
  }

  // ---------- urval i steg ----------
  const inDisc = o => !S.selDisc.size || S.selDisc.has(o.disc);
  const inKind = o => !S.selKinds.size || S.selKinds.has(o.kind);
  const base = () => S.objects.filter(o => inDisc(o) && inKind(o));
  const activeFilter = f => f.key && f.value !== '';
  const applyFilters = (list, upto) => {
    const fs = S.filters.slice(0, upto).filter(activeFilter);
    return fs.length ? list.filter(o => fs.every(f => o.props[f.key] === f.value)) : list;
  };
  function current() {
    let list = applyFilters(base(), S.filters.length);
    if ($('scopeSel').value === 'picked') list = list.filter(o => S.picked.has(o.guid));
    return list;
  }
  const hiddenKey = k => k.startsWith('@') || S.settings.hiddenPropertyPrefixes.some(h => k.startsWith(h));

  function chip(box, label, on, click) {
    const b = document.createElement('button');
    b.className = 'chip' + (on ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', click);
    box.appendChild(b);
  }

  function renderDisc() {
    const box = $('discChips'); box.innerHTML = '';
    const c = countBy(S.objects, o => o.disc);
    Object.keys(c).sort(byText).forEach(d => chip(box, `${d} (${c[d]})`, S.selDisc.has(d), () => {
      S.selDisc.has(d) ? S.selDisc.delete(d) : S.selDisc.add(d);
      syncLayers(); update();
    }));
    $('discInfo').textContent = 'Disciplin ' + S.disc.label + '.';
  }

  function renderKinds() {
    const box = $('classChips'); box.innerHTML = '';
    const c = countBy(S.objects.filter(inDisc), o => o.kind);
    [...S.selKinds].forEach(k => { if (!c[k]) S.selKinds.delete(k); });
    Object.keys(c).sort((a, b) => byText(kindLabel(a), kindLabel(b))).forEach(k => chip(box, `${kindLabel(k)} (${c[k]})`, S.selKinds.has(k), () => {
      S.selKinds.has(k) ? S.selKinds.delete(k) : S.selKinds.add(k);
      update();
    }));
  }

  function keysIn(list) {
    const keys = new Set();
    list.forEach(o => Object.keys(o.props).forEach(k => { if (!hiddenKey(k) && o.props[k] !== '') keys.add(k); }));
    return [...keys].sort((a, b) => byText(keyLabel(a), keyLabel(b)));
  }

  function renderFilters() {
    const box = $('filters'); box.innerHTML = '';
    const b = base();
    S.filters.forEach((f, idx) => {
      const subset = applyFilters(b, idx);
      const row = document.createElement('div'); row.className = 'frow';
      const ks = document.createElement('select'), vs = document.createElement('select'), rm = document.createElement('button');
      option(ks, '', '(parameter)');
      const keys = keysIn(subset);
      if (f.key && !keys.includes(f.key)) keys.unshift(f.key);
      keys.forEach(k => option(ks, k, keyLabel(k)));
      ks.value = f.key;
      option(vs, '', f.key ? '(välj värde)' : '–');
      if (f.key) {
        const c = countBy(subset.filter(o => o.props[f.key] !== undefined && o.props[f.key] !== ''), o => o.props[f.key]);
        if (f.value && !c[f.value]) c[f.value] = 0;
        Object.keys(c).sort(byText).forEach(v => option(vs, v, `${v} (${c[v]})`));
      }
      vs.value = f.value; vs.disabled = !f.key;
      rm.textContent = '✕'; rm.title = 'Ta bort filter'; rm.className = 'ghost';
      ks.addEventListener('change', () => { f.key = ks.value; f.value = ''; update(); });
      vs.addEventListener('change', () => { f.value = vs.value; update(); });
      rm.addEventListener('click', () => { S.filters.splice(idx, 1); update(); });
      row.append(ks, vs, rm);
      box.appendChild(row);
    });
  }

  function renderGroupSel() {
    const sel = $('groupSel'), cur = sel.value || '@kind';
    sel.innerHTML = '';
    option(sel, '@kind', 'IFC-klass');
    option(sel, '@disc', 'Disciplin');
    keysIn(base()).forEach(k => option(sel, k, keyLabel(k)));
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '@kind';
  }

  function update() {
    clearError();
    renderDisc(); renderKinds(); renderFilters(); renderGroupSel(); updatePicked();
    S.cur = current();
    buildGroups();
    renderResult();
  }

  // ---------- mängder ----------
  function emptyAgg(name) { return { name, count: 0, length: 0, area: 0, volume: 0, has: { length: 0, area: 0, volume: 0 }, missing: 0, guids: [], kinds: new Set() }; }
  function addTo(a, o) {
    a.count++; a.guids.push(o.guid); a.kinds.add(o.kind);
    let any = false;
    QTY.forEach(t => { if (o.q[t] !== null) { a[t] += o.q[t]; a.has[t]++; any = true; } });
    if (!any) a.missing++;
  }
  function groupValue(o, key) {
    if (key === '@kind') return o.label;
    if (key === '@disc') return o.disc;
    return o.props[key] ? o.props[key] : MISSING;
  }
  function buildGroups() {
    const key = $('groupSel').value || '@kind', map = new Map(), total = emptyAgg('Totalt');
    S.cur.forEach(o => {
      const g = groupValue(o, key);
      if (!map.has(g)) map.set(g, emptyAgg(g));
      addTo(map.get(g), o); addTo(total, o);
    });
    S.groups = [...map.values()].sort((a, b) => (a.name === MISSING) - (b.name === MISSING) || byText(a.name, b.name));
    S.total = total;
    S.groupKey = key;
  }

  const cell = (a, t) => a.has[t] ? fmt(a[t]) : '–';
  function renderResult() {
    $('resultCard').hidden = false;
    $('resultTitle').textContent = `Urval: ${S.total.count.toLocaleString('sv-SE')} objekt`;
    $('groupHead').textContent = keyLabel(S.groupKey);
    const tb = $('resultTable').tBodies[0], tf = $('resultTable').tFoot;
    tb.innerHTML = ''; tf.innerHTML = ''; S.selectedRow = null;
    const mkRow = (a, parent) => {
      const tr = document.createElement('tr');
      [a.name, a.count.toLocaleString('sv-SE'), cell(a, 'length'), cell(a, 'area'), cell(a, 'volume')].forEach((v, i) => {
        const td = document.createElement('td'); td.textContent = v; if (i) td.className = 'num'; tr.appendChild(td);
      });
      tr.addEventListener('click', () => {
        document.querySelectorAll('#resultTable tr.sel').forEach(x => x.classList.remove('sel'));
        tr.classList.add('sel'); S.selectedRow = a; show3D();
      });
      parent.appendChild(tr);
    };
    if (!S.groups.length) {
      const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 5;
      td.textContent = $('scopeSel').value === 'picked' && !S.picked.size ? 'Klicka på objekt i 3D-vyn för att markera dem.' : 'Inga objekt matchar urvalet.';
      tr.appendChild(td); tb.appendChild(tr);
    }
    S.groups.forEach(g => mkRow(g, tb));
    if (S.groups.length) mkRow(S.total, tf);

    const warns = [];
    if (S.truncated) warns.push(`Inläsningen stoppades vid ${S.settings.search.maxObjects.toLocaleString('sv-SE')} objekt.`);
    if (S.total.missing) {
      const per = countBy(S.cur.filter(o => QTY.every(t => o.q[t] === null)), o => o.label);
      const txt = Object.entries(per).map(([k, n]) => `${k} ${n}`).join(', ');
      warns.push(S.total.missing === S.total.count
        ? `Inga kvantiteter hittades (${txt}). Exportera IFC med baskvantiteter (BaseQuantities/Qto_*). Antal stämmer ändå.`
        : `${S.total.missing} av ${S.total.count} objekt saknar kvantiteter: ${txt}. De räknas i antal men inte i längd, area eller volym.`);
    }
    $('warn').textContent = warns.join(' ');
    $('warn').hidden = !warns.length;
    $('exportBtn').disabled = !S.cur.length;
  }

  // ---------- 3D (påverkar bara vyn) ----------
  async function show3D() {
    const a = S.selectedRow; if (!a) return;
    const api = S.api;
    clearError();
    try {
      if (S.hidden) { await api.showAllObjects(); S.hidden = false; }
      const map = {}; a.guids.forEach(g => { map[g] = S.settings.highlightColor; });
      await api.colorCodeObjects(map);
      if (S.mode === 'iso') {
        const kinds = [...a.kinds];
        const q = kindQuery(kinds[0], S.settings.search.maxObjects, 0);
        q.filter.rules = kinds.map(k => kindQuery(k, 1, 0).filter.rules[0]);
        await api.applyObjectSearch(q, true);
        await api.setSearchVisualizationMode('HIDDEN');
        const inGroup = new Set(a.guids);
        const others = S.objects.filter(o => a.kinds.has(o.kind) && !inGroup.has(o.guid));
        if (others.length <= 3000) { for (const o of others) await api.hideObject(o.guid); S.hidden = others.length > 0; }
        else showError(`Visar gruppen i färg. Fler än 3 000 andra objekt av samma typ kan inte döljas ett och ett.`);
        await api.zoomToSearchResult();
      } else {
        await api.resetObjectSearch();
        await api.setSearchVisualizationMode('ORIGINAL');
        if (a.guids.length) await api.gotoObject(a.guids[0]);
      }
    } catch (e) { showError(e); }
  }

  async function syncLayers() {
    if (S.disc.mode !== 'layers' || !S.layersOrig) return;
    try {
      const m = {};
      Object.keys(S.layersOrig).forEach(n => { m[n] = S.selDisc.size ? S.selDisc.has(n) : S.layersOrig[n]; });
      await S.api.setLayers(m); S.layersChanged = S.selDisc.size > 0;
    } catch (e) { debug('setLayers FEL', e); }
  }

  async function resetView() {
    clearError();
    document.querySelectorAll('#resultTable tr.sel').forEach(x => x.classList.remove('sel'));
    S.selectedRow = null;
    const api = S.api;
    try {
      await api.colorCodeObjects({});
      await api.resetObjectSearch();
      await api.setSearchVisualizationMode('ORIGINAL');
      if (S.hidden) { await api.showAllObjects(); S.hidden = false; }
      if (S.layersChanged && S.layersOrig) { await api.setLayers(S.layersOrig); S.layersChanged = false; }
    } catch (e) { showError(e); }
  }

  function setMode(m) {
    S.mode = m;
    $('modeMark').classList.toggle('on', m === 'mark');
    $('modeIso').classList.toggle('on', m === 'iso');
    if (S.selectedRow) show3D();
  }

  function onPicked(result) {
    if (!result || !result.guid) return;
    S.picked.has(result.guid) ? S.picked.delete(result.guid) : S.picked.add(result.guid);
    if ($('scopeSel').value === 'picked') update(); else updatePicked();
  }
  function updatePicked() {
    $('pickedTxt').textContent = `Markerade objekt: ${S.picked.size}. Klicka i 3D för att lägga till eller ta bort.`;
    $('pickedInfo').hidden = $('scopeSel').value !== 'picked';
  }

  // ---------- Excel ----------
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|,]/g, '').trim().replace(/\s+/g, '_') || 'projekt'; }
  const r3 = n => Math.round(n * 1000) / 1000;
  function numFormat(ws, r0, r1, cols) {
    for (let r = r0; r <= r1; r++) cols.forEach(c => {
      const ref = window.XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && ws[ref].t === 'n') ws[ref].z = '#,##0.00';
    });
  }
  function exportExcel() {
    if (!S.cur.length) return;
    clearError();
    try {
      const XLSX = window.XLSX, gl = keyLabel(S.groupKey), q = (a, t) => a.has[t] ? r3(a[t]) : null;
      const fs = S.filters.filter(activeFilter);
      const head = [
        [`Mängdning – ${S.projectName}`],
        ['Projekt-ID', S.projectId], ['Byggnads-ID', S.buildingId], ['Mängdat', new Date().toLocaleString('sv-SE')], ['Användare', S.email],
        ['Disciplin', S.selDisc.size ? [...S.selDisc].join(', ') : '(alla)'],
        ['Objekttyper', S.selKinds.size ? [...S.selKinds].map(kindLabel).join(', ') : '(alla)']
      ];
      if (fs.length) fs.forEach((f, i) => head.push([i ? '' : 'Filter', `${keyLabel(f.key)} = ${f.value}`]));
      else head.push(['Filter', '(inga)']);
      head.push(['Omfång', $('scopeSel').value === 'picked' ? 'Bara markerade i 3D' : 'Hela urvalet'], ['Gruppering', gl]);
      if (S.total.missing) head.push(['OBS', `${S.total.missing} objekt saknar kvantiteter`]);
      head.push([]);
      const hdr = head.length;
      head.push([gl, 'Antal (st)', 'Längd (m)', 'Area (m²)', 'Volym (m³)', 'Saknar kvantitet (st)']);
      S.groups.forEach(g => head.push([g.name, g.count, q(g, 'length'), q(g, 'area'), q(g, 'volume'), g.missing]));
      head.push(['Totalt', S.total.count, q(S.total, 'length'), q(S.total, 'area'), q(S.total, 'volume'), S.total.missing]);
      const ws1 = XLSX.utils.aoa_to_sheet(head);
      ws1['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }];
      numFormat(ws1, hdr + 1, head.length - 1, [2, 3, 4]);

      const extra = [...new Set([S.groupKey].concat(fs.map(f => f.key)).filter(k => !k.startsWith('@')))];
      const rows = [['GUID', 'Namn', 'Disciplin', 'IFC-klass'].concat(extra.map(keyLabel), ['Längd (m)', 'Area (m²)', 'Volym (m³)', 'Kvantitetskälla'])];
      S.cur.forEach(o => rows.push([o.guid, o.name, o.disc, o.label].concat(extra.map(k => o.props[k] || ''),
        [o.q.length === null ? null : r3(o.q.length), o.q.area === null ? null : r3(o.q.area), o.q.volume === null ? null : r3(o.q.volume), o.q.src.join('; ') || 'saknas'])));
      const ws2 = XLSX.utils.aoa_to_sheet(rows);
      ws2['!cols'] = [{ wch: 24 }, { wch: 30 }, { wch: 14 }, { wch: 14 }].concat(extra.map(() => ({ wch: 18 })), [{ wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 34 }]);
      ws2['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
      const qc = 4 + extra.length;
      numFormat(ws2, 1, rows.length - 1, [qc, qc + 1, qc + 2]);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Sammanställning');
      XLSX.utils.book_append_sheet(wb, ws2, 'Objektlista');
      XLSX.writeFile(wb, `${safeName(S.projectName)}_mängdning_${today()}.xlsx`);
    } catch (e) { showError(e); }
  }

  // ---------- uppstart ----------
  async function connect() {
    const mock = new URLSearchParams(location.search).has('mock') || window.parent === window;
    const callbacks = { pickedObject: onPicked };
    if (mock) {
      $('mockBadge').hidden = false;
      window.StreamBIM.API = window.StreamBIMMock.create(callbacks);
      return window.StreamBIM.API;
    }
    const timeout = new Promise((_, rej) => setTimeout(() => rej('Kunde inte ansluta. Widgeten måste öppnas inifrån StreamBIM (eller med ?mock=1 för demo).'), 15000));
    await Promise.race([window.StreamBIM.connectToParent(window.parent, callbacks), timeout]);
    return window.StreamBIM.API;
  }

  async function boot() {
    try {
      S.settings = await loadJson('config/settings.json');
      S.api = await connect();
      const api = S.api;
      [S.email, S.projectId, S.buildingId] = await Promise.all([
        api.getUserEmail().catch(() => ''), api.getProjectId().catch(() => ''), api.getBuildingId().catch(() => '')
      ]);
      debug('getUserEmail / getProjectId / getBuildingId', { email: S.email, projectId: S.projectId, buildingId: S.buildingId });
      S.projectName = S.settings.projectNames[S.projectId] || ('projekt-' + S.projectId);
      $('who').textContent = `${S.projectName}${S.email ? ' · ' + S.email : ''}`;
      await loadModel();
    } catch (e) { showError(e); $('who').textContent = ''; }
  }

  $('clearDiscBtn').addEventListener('click', () => { S.selDisc.clear(); syncLayers(); update(); });
  $('clearClassesBtn').addEventListener('click', () => { S.selKinds.clear(); update(); });
  $('addFilterBtn').addEventListener('click', () => { S.filters.push({ key: '', value: '' }); update(); });
  $('clearFiltersBtn').addEventListener('click', () => { S.filters = []; update(); });
  $('scopeSel').addEventListener('change', update);
  $('groupSel').addEventListener('change', update);
  $('clearPickedBtn').addEventListener('click', () => { S.picked.clear(); update(); });
  $('reloadBtn').addEventListener('click', loadModel);
  $('resetViewBtn').addEventListener('click', resetView);
  $('modeMark').addEventListener('click', () => setMode('mark'));
  $('modeIso').addEventListener('click', () => setMode('iso'));
  $('exportBtn').addEventListener('click', exportExcel);

  boot();
})();
