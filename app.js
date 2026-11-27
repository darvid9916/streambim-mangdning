/* Mängdning – StreamBIM-widget (endast läsning)
 * Steg: 1. disciplin → 2. objekttyp → 3. parametrar. Varje steg visar bara det som finns kvar.
 * Disciplin och objekttyp visas direkt från StreamBIMs antal per IFC-klass (valuesForObjectProperty('@kind')).
 * Objekt läses in först när objekttyp är vald: GUID:er via findObjects, egenskaper via getObjectInfo.
 * Stora urval (> autoLoad) snävas in på servern med findObjects per filter innan något läses in.
 * Widgeten skriver aldrig till modell eller projekt, den ändrar bara vyn. "Återställ vy" nollställer den.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const S = {
    settings: null, api: null, projectId: '', projectName: '', buildingId: '', email: '',
    kinds: [], selDisc: new Set(), selKinds: new Set(), filters: [], picked: new Set(),
    guids: new Map(), kindOf: new Map(), info: new Map(),
    mode: 'none', pool: [], objects: [], cur: [], groups: [], total: null, groupKey: '@kind',
    view: 'mark', selectedRow: null, hidden: false, token: 0, bulk: undefined
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
  const norm = k => String(k).replace(/^ifc/i, '').replace(/[\s_-]/g, '').toLowerCase();
  const fmt = (n, d = 2) => n.toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const num = n => n.toLocaleString('sv-SE');
  const byText = (a, b) => String(a).localeCompare(String(b), 'sv', { numeric: true });
  const kindLabel = raw => /^ifc/i.test(raw) ? String(raw)
    : 'Ifc' + String(raw).split(/[\s_]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('');
  const keyLabel = k => {
    if (k === '@kind') return 'IFC-klass';
    if (k === '@disc') return 'Disciplin';
    if (k.startsWith('@')) return k.slice(1);
    const s = splitKey(k); return s.pset ? `${s.key} (${s.pset})` : s.key;
  };
  function countBy(list, fn) { const m = {}; list.forEach(o => { const k = fn(o); m[k] = (m[k] || 0) + 1; }); return m; }
  function option(sel, value, label) { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); }
  function setProgress(txt) { $('progress').hidden = !txt; if (txt) $('progressTxt').textContent = txt; }
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Svarsformaten är odokumenterade: tål lista, {values:[...]}, {värde: antal} m.m.
  function toCounts(res) {
    if (Array.isArray(res)) { const m = {}; res.forEach(v => { const k = str(lastSeg((v && typeof v === 'object') ? (v.value ?? v.name ?? v.key) : v)); if (k) m[k] = (m[k] || 0) + (v && typeof v === 'object' && typeof v.count === 'number' ? v.count : 0); }); return m; }
    if (res && typeof res === 'object') {
      for (const k of ['values', 'data', 'result', 'results', 'items']) if (Array.isArray(res[k])) return toCounts(res[k]);
      const m = {}; Object.entries(res).forEach(([k, v]) => { m[str(lastSeg(k))] = typeof v === 'number' ? v : 0; }); return m;
    }
    return {};
  }
  function toObjectList(res) {
    if (Array.isArray(res)) return res;
    if (res && typeof res === 'object') {
      for (const k of ['objects', 'values', 'data', 'result', 'results', 'items']) if (Array.isArray(res[k])) return res[k];
      return Object.values(res).filter(x => x && typeof x === 'object');
    }
    return [];
  }
  function guidList(res) {
    if (typeof res === 'string') { try { res = JSON.parse(res); } catch (_) { return res ? [res] : []; } }
    const arr = Array.isArray(res) ? res : toObjectList(res);
    return arr.map(x => (x && typeof x === 'object') ? (x.guid || x.id || x.globalId) : x).filter(Boolean).map(String);
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
    pre.textContent += `${label}: ${String(txt).slice(0, 1200)}\n\n`;
    console.info('[debug]', label, data);
  }
  function toNum(v) {
    v = first(v);
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v === undefined || v === null) return null;
    const n = parseFloat(String(lastSeg(v)).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  // Egenskaper platt: "Pset~Nyckel" → text. Klarar både platt och nästlat format.
  function flatten(info) {
    const out = {};
    Object.entries(info.properties || {}).forEach(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.entries(v).forEach(([kk, vv]) => { out[k + '~' + kk] = str(lastSeg(first(vv))); });
      else out[k] = str(lastSeg(first(v)));
    });
    return out;
  }
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
  function makeObj(guid, info) {
    const kind = S.kindOf.get(guid) || '';
    const f = flatten(info);
    const k = S.kinds.find(x => x.raw === kind);
    return { guid, name: info.name || f.Name || guid, kind, label: kindLabel(kind), disc: k ? k.disc : '', props: f, q: quantities(info, kind) };
  }

  // ---------- steg 1 och 2: direkt från antal per klass ----------
  function discOf(raw) {
    const D = S.settings.discipline;
    const hit = Object.entries(D.byClass).find(([, ks]) => ks.some(k => norm(k) === norm(raw)));
    return hit ? hit[0] : D.other;
  }
  async function loadKinds() {
    setProgress('Läser objekttyper i modellen…');
    const raw = await S.api.valuesForObjectProperty(S.settings.search.kindKey);
    debug('valuesForObjectProperty @kind', raw);
    const excl = new Set(S.settings.excludeKinds.map(norm));
    S.kinds = Object.entries(toCounts(raw)).filter(([k]) => k && !excl.has(norm(k)))
      .map(([k, n]) => ({ raw: k, label: kindLabel(k), count: n, disc: discOf(k) }))
      .sort((a, b) => byText(a.label, b.label));
    setProgress('');
    if (!S.kinds.length) throw 'StreamBIM gav inga objekttyper för modellen.';
  }

  const inDisc = k => !S.selDisc.size || S.selDisc.has(k.disc);
  function chip(box, label, on, click) {
    const b = document.createElement('button');
    b.className = 'chip' + (on ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', click);
    box.appendChild(b);
  }
  function renderDisc() {
    const box = $('discChips'); box.innerHTML = '';
    const c = {}; S.kinds.forEach(k => { c[k.disc] = (c[k.disc] || 0) + k.count; });
    Object.keys(c).sort((a, b) => (a === S.settings.discipline.other) - (b === S.settings.discipline.other) || byText(a, b))
      .forEach(d => chip(box, `${d} (${num(c[d])})`, S.selDisc.has(d), () => {
        S.selDisc.has(d) ? S.selDisc.delete(d) : S.selDisc.add(d);
        [...S.selKinds].forEach(r => { const k = S.kinds.find(x => x.raw === r); if (k && !inDisc(k)) S.selKinds.delete(r); });
        renderDisc(); renderKinds(); selectionChanged();
      }));
    $('discInfo').textContent = 'Disciplin enligt IFC-klass (kan justeras i settings.json).';
  }
  function renderKinds() {
    const box = $('classChips'); box.innerHTML = '';
    S.kinds.filter(inDisc).forEach(k => chip(box, `${k.label} (${num(k.count)})`, S.selKinds.has(k.raw), () => {
      S.selKinds.has(k.raw) ? S.selKinds.delete(k.raw) : S.selKinds.add(k.raw);
      renderKinds(); selectionChanged();
    }));
  }

  // ---------- inläsning av valda objekttyper ----------
  async function guidsForKind(raw) {
    if (S.guids.has(raw)) return S.guids.get(raw);
    const k = S.kinds.find(x => x.raw === raw);
    const res = await S.api.findObjects({ key: S.settings.search.kindKey, value: raw, limit: Math.max(100, (k ? k.count : 0) + 100) });
    const g = guidList(res);
    g.forEach(x => S.kindOf.set(x, raw));
    S.guids.set(raw, g);
    debug(`findObjects ${raw}`, { antal: g.length, förväntat: k && k.count });
    return g;
  }

  // Försök hämta hela klassen i ett anrop (enkel sökform). Annars objekt för objekt.
  async function bulkLoad(raw, token) {
    if (S.bulk === false) return false;
    try {
      const k = S.kinds.find(x => x.raw === raw);
      const res = toObjectList(await S.api.getObjectInfoForSearch({ key: S.settings.search.kindKey, value: raw, limit: (k ? k.count : 1000) + 100 }));
      if (token !== S.token) return true;
      if (!res.length) { if (S.bulk === undefined) { S.bulk = false; debug('getObjectInfoForSearch {key,value}', 'inga träffar – läser objekt för objekt'); } return false; }
      if (S.bulk === undefined) debug('getObjectInfoForSearch {key,value} fungerar', { antal: res.length, första: res[0] });
      S.bulk = true;
      res.forEach(i => { const g = i.guid || i.id || i.globalId; if (g) { S.kindOf.set(String(g), raw); S.info.set(String(g), makeObj(String(g), i)); } });
      return true;
    } catch (e) { if (S.bulk === undefined) debug('getObjectInfoForSearch {key,value} FEL – läser objekt för objekt', e); S.bulk = false; return false; }
  }

  async function loadInfos(guids, token) {
    const todo = guids.filter(g => !S.info.has(g));
    const B = S.settings.search.batch;
    let done = guids.length - todo.length;
    for (let i = 0; i < todo.length; i += B) {
      if (token !== S.token) return false;
      setProgress(`Läser in objekt… ${num(done)} av ${num(guids.length)}`);
      const part = await Promise.all(todo.slice(i, i + B).map(g => S.api.getObjectInfo(g).then(info => [g, info]).catch(() => [g, null])));
      part.forEach(([g, info]) => { if (info && typeof info === 'object') S.info.set(g, makeObj(g, info)); });
      done += part.length;
    }
    if (todo.length && S.info.has(todo[0])) debug('getObjectInfo (första objektet)', S.info.get(todo[0]).props);
    return true;
  }

  function sampleOf(list, n) {
    if (list.length <= n) return list.slice();
    const step = list.length / n, out = [];
    for (let i = 0; i < n; i++) out.push(list[Math.floor(i * step)]);
    return out;
  }
  const inter = (a, bset) => a.filter(x => bset.has(x));

  async function selectionChanged() {
    S.filters = [];
    await recompute(true);
  }

  // Räknar fram urvalet: hela klasser → snäva in med serverfilter → läs in om det är litet nog
  async function recompute(kindsChanged) {
    const token = ++S.token;
    clearError();
    const kinds = [...S.selKinds];
    if (!kinds.length) { S.mode = 'none'; S.objects = []; render(); return; }
    try {
      let union = [];
      for (const raw of kinds) {
        setProgress(`Hämtar ${kindLabel(raw)}…`);
        union = union.concat(await guidsForKind(raw));
        if (token !== S.token) return;
      }
      union = [...new Set(union)];
      const allCached = union.every(g => S.info.has(g));
      const active = S.filters.filter(f => f.key && f.value !== '');
      let pool = union;
      if (!allCached) {
        for (const f of active) {
          if (!f.guids) {
            setProgress(`Filtrerar på ${keyLabel(f.key)}…`);
            const res = await S.api.findObjects({ key: f.key, value: f.value, limit: S.settings.search.maxLoad * 10 });
            f.guids = new Set(guidList(res));
            debug(`findObjects ${f.key}=${f.value}`, { antal: f.guids.size });
          }
          pool = inter(pool, f.guids);
          if (token !== S.token) return;
        }
      }
      S.pool = pool;
      if (allCached || pool.length <= S.settings.search.autoLoad) {
        if (!allCached) {
          const whole = active.length === 0;
          if (whole) for (const raw of kinds) { await bulkLoad(raw, token); if (token !== S.token) return; }
          if (!await loadInfos(pool, token)) return;
        }
        S.mode = 'full';
        S.objects = (allCached ? union : pool).map(g => S.info.get(g)).filter(Boolean);
      } else {
        setProgress('Läser ett urval för att hitta parametrar…');
        const smp = sampleOf(pool, S.settings.search.sampleSize);
        if (!await loadInfos(smp, token)) return;
        S.mode = 'partial';
        S.objects = smp.map(g => S.info.get(g)).filter(Boolean);
      }
    } catch (e) { if (token === S.token) showError(e); }
    finally { if (token === S.token) setProgress(''); }
    if (token === S.token) render();
  }

  async function loadAll() {
    const token = ++S.token;
    if (S.pool.length > S.settings.search.maxLoad) { showError(`Urvalet är för stort (${num(S.pool.length)} objekt, max ${num(S.settings.search.maxLoad)}). Lägg till ett filter först.`); return; }
    try {
      if (!S.filters.some(f => f.key && f.value !== '')) for (const raw of S.selKinds) { await bulkLoad(raw, token); if (token !== S.token) return; }
      if (!await loadInfos(S.pool, token)) return;
      S.mode = 'full';
      S.objects = S.pool.map(g => S.info.get(g)).filter(Boolean);
    } catch (e) { showError(e); }
    finally { if (token === S.token) setProgress(''); }
    if (token === S.token) render();
  }

  // ---------- steg 3: parametrar ----------
  const activeFilter = f => f.key && f.value !== '';
  const applyFilters = (list, upto) => {
    const fs = S.filters.slice(0, upto).filter(activeFilter);
    return fs.length ? list.filter(o => fs.every(f => o.props[f.key] === f.value)) : list;
  };
  const hiddenKey = k => S.settings.hiddenPropertyPrefixes.some(h => k.startsWith(h));
  function keysIn(list) {
    const keys = new Set();
    list.forEach(o => Object.keys(o.props).forEach(k => { if (!hiddenKey(k) && o.props[k] !== '') keys.add(k); }));
    return [...keys].sort((a, b) => byText(keyLabel(a), keyLabel(b)));
  }

  function renderFilters() {
    const box = $('filters'); box.innerHTML = '';
    S.filters.forEach((f, idx) => {
      const row = document.createElement('div'); row.className = 'frow';
      const ks = document.createElement('select'), vs = document.createElement('select'), rm = document.createElement('button');
      const subset = S.mode === 'full' ? applyFilters(S.objects, idx) : S.objects;
      option(ks, '', '(parameter)');
      const keys = keysIn(subset);
      if (f.key && !keys.includes(f.key)) keys.unshift(f.key);
      keys.forEach(k => option(ks, k, keyLabel(k)));
      ks.value = f.key;
      option(vs, '', f.key ? '(välj värde)' : '–');
      if (f.key) {
        let c;
        if (S.mode === 'full') c = countBy(subset.filter(o => o.props[f.key]), o => o.props[f.key]);
        else c = f.modelValues || {};
        if (f.value && c[f.value] === undefined) c[f.value] = 0;
        Object.keys(c).sort(byText).forEach(v => option(vs, v, c[v] ? `${v} (${num(c[v])})` : v));
      }
      vs.value = f.value; vs.disabled = !f.key;
      rm.textContent = '✕'; rm.title = 'Ta bort filter'; rm.className = 'ghost';
      ks.addEventListener('change', async () => {
        if (f.guids) { f.key = ks.value; f.value = ''; f.guids = null; f.modelValues = null; await recompute(false); return; }
        f.key = ks.value; f.value = ''; f.guids = null; f.modelValues = null;
        if (f.key && S.mode !== 'full') {
          try { const raw = await S.api.valuesForObjectProperty(f.key); f.modelValues = toCounts(raw); debug('valuesForObjectProperty ' + f.key, raw); }
          catch (e) { f.modelValues = countBy(S.objects.filter(o => o.props[f.key]), o => o.props[f.key]); }
        }
        render();
      });
      vs.addEventListener('change', () => { const srv = !!f.guids; f.value = vs.value; f.guids = null; (S.mode === 'full' && !srv) ? render() : recompute(false); });
      rm.addEventListener('click', () => { const srv = !!f.guids || S.mode !== 'full'; S.filters.splice(idx, 1); srv ? recompute(false) : render(); });
      row.append(ks, vs, rm);
      box.appendChild(row);
    });
    $('filterNote').textContent = S.mode === 'partial'
      ? 'Stort urval: parametrar kommer från ett stickprov och värden från hela modellen. Välj ett värde för att snäva in.'
      : '';
  }

  function renderGroupSel() {
    const sel = $('groupSel'), cur = sel.value || S.groupKey || '@kind';
    sel.innerHTML = '';
    option(sel, '@kind', 'IFC-klass');
    option(sel, '@disc', 'Disciplin');
    keysIn(S.objects).forEach(k => option(sel, k, keyLabel(k)));
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '@kind';
  }

  function render() {
    renderFilters(); renderGroupSel(); updatePicked();
    const has = S.mode !== 'none';
    $('filterCard').hidden = !has; $('optCard').hidden = !has;
    $('bigCard').hidden = S.mode !== 'partial';
    $('resultCard').hidden = S.mode !== 'full';
    if (S.mode === 'partial') {
      $('bigTxt').textContent = `Urvalet har ${num(S.pool.length)} objekt. Lägg till ett filter för att snäva in till högst ${num(S.settings.search.autoLoad)}, så mängdas det direkt. Du kan också läsa in alla, men det kan ta flera minuter.`;
      $('loadAllBtn').textContent = `Läs in alla ${num(S.pool.length)}`;
      $('loadAllBtn').disabled = S.pool.length > S.settings.search.maxLoad;
    }
    $('hintTxt').hidden = has;
    if (S.mode !== 'full') return;
    S.cur = applyFilters(S.objects, S.filters.length);
    if ($('scopeSel').value === 'picked') S.cur = S.cur.filter(o => S.picked.has(o.guid));
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
    S.total = total; S.groupKey = key;
  }
  const cell = (a, t) => a.has[t] ? fmt(a[t]) : '–';
  function renderResult() {
    $('resultTitle').textContent = `Urval: ${num(S.total.count)} objekt`;
    $('groupHead').textContent = keyLabel(S.groupKey);
    const tb = $('resultTable').tBodies[0], tf = $('resultTable').tFoot;
    tb.innerHTML = ''; tf.innerHTML = ''; S.selectedRow = null;
    const mkRow = (a, parent) => {
      const tr = document.createElement('tr');
      [a.name, num(a.count), cell(a, 'length'), cell(a, 'area'), cell(a, 'volume')].forEach((v, i) => {
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
    if (S.total.missing) {
      const per = countBy(S.cur.filter(o => QTY.every(t => o.q[t] === null)), o => o.label);
      const txt = Object.entries(per).map(([k, n]) => `${k} ${num(n)}`).join(', ');
      warns.push(S.total.missing === S.total.count
        ? `Inga kvantiteter hittades (${txt}). Exportera IFC med baskvantiteter (BaseQuantities/Qto_*). Antal stämmer ändå.`
        : `${num(S.total.missing)} av ${num(S.total.count)} objekt saknar kvantiteter: ${txt}. De räknas i antal men inte i längd, area eller volym.`);
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
      if (S.view === 'iso') {
        const kinds = [...a.kinds];
        for (let i = 0; i < kinds.length; i++) {
          const k = S.kinds.find(x => x.raw === kinds[i]);
          await api.applyObjectSearch({ key: S.settings.search.kindKey, value: kinds[i], limit: (k ? k.count : 1000) + 100 }, i === 0);
        }
        await api.setSearchVisualizationMode('HIDDEN');
        const inGroup = new Set(a.guids);
        const others = kinds.flatMap(k => S.guids.get(k) || []).filter(g => !inGroup.has(g));
        if (others.length <= 3000) { for (const g of others) await api.hideObject(g); S.hidden = others.length > 0; }
        else showError(`Gruppen visas i färg. ${num(others.length)} andra objekt av samma typ är för många att dölja ett och ett.`);
        await api.zoomToSearchResult();
      } else {
        await api.resetObjectSearch();
        await api.setSearchVisualizationMode('ORIGINAL');
        if (a.guids.length) await api.gotoObject(a.guids[0]);
      }
    } catch (e) { showError(e); }
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
    } catch (e) { showError(e); }
  }
  function setView(m) {
    S.view = m;
    $('modeMark').classList.toggle('on', m === 'mark');
    $('modeIso').classList.toggle('on', m === 'iso');
    if (S.selectedRow) show3D();
  }
  function onPicked(result) {
    if (!result || !result.guid) return;
    S.picked.has(result.guid) ? S.picked.delete(result.guid) : S.picked.add(result.guid);
    if ($('scopeSel').value === 'picked') render(); else updatePicked();
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
      await loadKinds();
      $('discCard').hidden = false; $('classCard').hidden = false;
      renderDisc(); renderKinds(); render();
    } catch (e) { setProgress(''); showError(e); }
  }

  $('clearDiscBtn').addEventListener('click', () => { S.selDisc.clear(); renderDisc(); renderKinds(); });
  $('clearClassesBtn').addEventListener('click', () => { S.selKinds.clear(); renderKinds(); selectionChanged(); });
  $('addFilterBtn').addEventListener('click', () => { S.filters.push({ key: '', value: '' }); render(); });
  $('clearFiltersBtn').addEventListener('click', () => { const srv = S.filters.some(f => f.guids); S.filters = []; srv ? recompute(false) : render(); });
  $('scopeSel').addEventListener('change', render);
  $('groupSel').addEventListener('change', render);
  $('clearPickedBtn').addEventListener('click', () => { S.picked.clear(); render(); });
  $('loadAllBtn').addEventListener('click', loadAll);
  $('resetViewBtn').addEventListener('click', resetView);
  $('modeMark').addEventListener('click', () => setView('mark'));
  $('modeIso').addEventListener('click', () => setView('iso'));
  $('exportBtn').addEventListener('click', exportExcel);

  boot();
})();
