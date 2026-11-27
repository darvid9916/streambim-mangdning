/* Mängdning – StreamBIM-widget (endast läsning)
 * Flöde: välj IFC-klasser → filter (OCH) → getObjectInfoForSearch (paginerat, en sökning per klass)
 *        → kvantiteter från BaseQuantities/Qto_* → gruppering → 3D-koppling → Excel (SheetJS).
 * Widgeten skriver aldrig till modell eller projekt. Den ändrar bara vyn (sökning, färg, kamera).
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const S = {
    settings: null, api: null, projectId: '', projectName: '', buildingId: '', email: '',
    classes: [], selKinds: new Set(), filters: [], propKeys: [], sampled: {},
    picked: new Set(), objects: [], groups: [], total: null, run: null,
    mode: 'mark', selectedRow: null, propsToken: 0
  };
  const QTY = ['length', 'area', 'volume'];
  const UNIT = { length: 'm', area: 'm²', volume: 'm³' };
  const QNAME = { length: 'Längd', area: 'Area', volume: 'Volym' };
  const SCOPE = { model: 'Hela modellen', picked: 'Markerade i 3D', layers: 'Synliga lager' };
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
  }
  const clearError = () => { $('error').hidden = true; };
  const first = v => Array.isArray(v) ? v[0] : v;

  // valuesForObjectProperty: formatet är odokumenterat. Tål lista, {values:[...]}, {värde: antal} m.m.
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
  // Felsökning: sätt "debug": true i config/settings.json för att se StreamBIMs råa svar i panelen
  function debug(label, data) {
    if (!S.settings || !S.settings.debug) return;
    let pre = document.getElementById('debug');
    if (!pre) {
      pre = document.createElement('pre'); pre.id = 'debug';
      pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;font-size:11px;background:#111;color:#9fe;padding:8px;border-radius:6px;user-select:text;';
      document.getElementById('app').appendChild(pre);
    }
    let txt; try { txt = JSON.stringify(data); } catch (_) { txt = String(data); }
    pre.textContent += `${label} (${Array.isArray(data) ? 'array' : typeof data}): ${String(txt).slice(0, 1500)}\n\n`;
    console.info('[debug]', label, data);
  }
  const lastSeg = v => (typeof v === 'string' && v.includes('~')) ? v.split('~').pop() : v;
  const splitKey = k => { const i = k.indexOf('~'); return i < 0 ? { pset: null, key: k } : { pset: k.slice(0, i), key: k.slice(i + 1) }; };
  const keyLabel = k => { if (k === '@kind') return 'IFC-klass'; const s = splitKey(k); return s.pset ? `${s.key} (${s.pset})` : s.key; };
  const kindLabel = kind => (S.classes.find(c => c.kind === kind) || {}).label || (String(kind).startsWith('Ifc') ? kind : 'Ifc' + kind);
  const fmt = (n, d = 2) => n.toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  function toNum(v) {
    v = first(v);
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v === undefined || v === null) return null;
    const n = parseFloat(String(lastSeg(v)).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  function propVal(info, fullKey) {
    const p = info.properties || {};
    if (p[fullKey] !== undefined) return lastSeg(first(p[fullKey]));
    const s = splitKey(fullKey);
    if (s.pset && p[s.pset] && typeof p[s.pset] === 'object' && !Array.isArray(p[s.pset]) && p[s.pset][s.key] !== undefined)
      return lastSeg(first(p[s.pset][s.key]));
    return undefined;
  }
  const guidOf = i => i.guid || i.id || i.globalId || propVal(i, 'GUID') || propVal(i, 'GlobalId');
  const nameOf = i => i.name || propVal(i, 'Name') || guidOf(i);
  function setProgress(txt) { $('progress').hidden = !txt; if (txt) $('progressTxt').textContent = txt; }
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---------- sökfrågor ----------
  function withOp(r) { const op = S.settings.search.equalsOperator; if (op) r.operator = op; return r; }
  function kindRule(kind) { return withOp({ buildingId: S.buildingId, propKey: S.settings.search.kindKey, propValue: kind }); }
  function propRule(fullKey, value) {
    const s = splitKey(fullKey);
    const r = { buildingId: S.buildingId, propKey: s.key, propValue: value };
    if (s.pset) r.psetName = s.pset;
    return withOp(r);
  }
  const activeFilters = () => S.filters.filter(f => f.key && f.value !== '');
  // Antagande: regler i samma inre array = OCH. En sökning per klass undviker antagandet om ELLER.
  function groupRules(kind, filters, extra) {
    return [kindRule(kind)].concat(filters.map(f => propRule(f.key, f.value)), extra || []);
  }

  // ---------- klasser och egenskaper ----------
  function renderChips() {
    const box = $('classChips');
    box.innerHTML = '';
    S.classes.forEach(c => {
      const b = document.createElement('button');
      b.className = 'chip' + (S.selKinds.has(c.kind) ? ' on' : '');
      b.textContent = c.label;
      b.addEventListener('click', () => {
        S.selKinds.has(c.kind) ? S.selKinds.delete(c.kind) : S.selKinds.add(c.kind);
        renderChips();
        refreshProps();
      });
      box.appendChild(b);
    });
  }

  async function refreshProps() {
    const token = ++S.propsToken;
    const kinds = [...S.selKinds];
    if (!kinds.length) { S.propKeys = []; S.sampled = {}; renderFilters(); renderGroupSel(); $('propsInfo').textContent = ''; return; }
    $('propsInfo').textContent = 'Läser egenskaper från modellen…';
    const keys = new Set(), sampled = {};
    const per = Math.max(20, Math.floor(S.settings.search.sampleSize / kinds.length));
    const hidden = S.settings.hiddenPropertyPrefixes;
    try {
      for (const kind of kinds) {
        const infos = await S.api.getObjectInfoForSearch({ filter: { rules: [[kindRule(kind)]] }, page: { limit: per, skip: 0 } });
        debug('getObjectInfoForSearch ' + kind + ' (första objektet)', Array.isArray(infos) ? infos[0] : infos);
        toObjectList(infos).forEach(i => Object.entries(i.properties || {}).forEach(([k, v]) => {
          if (hidden.some(h => k.startsWith(h)) || k === 'GUID' || k === 'GlobalId') return;
          if (v && typeof v === 'object' && !Array.isArray(v)) return;
          keys.add(k);
          const val = lastSeg(first(v));
          if (val !== undefined && val !== null && String(val) !== '') (sampled[k] = sampled[k] || new Set()).add(String(val));
        }));
      }
      if (token !== S.propsToken) return;
      S.propKeys = [...keys].sort((a, b) => keyLabel(a).localeCompare(keyLabel(b), 'sv'));
      S.sampled = sampled;
      $('propsInfo').textContent = `${S.propKeys.length} egenskaper hittades i ett urval av objekten.`;
    } catch (e) { if (token === S.propsToken) { showError(e); $('propsInfo').textContent = ''; } }
    renderFilters();
    renderGroupSel();
  }

  function option(sel, value, label) { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); }

  function renderGroupSel() {
    const sel = $('groupSel'), cur = sel.value || '@kind';
    sel.innerHTML = '';
    option(sel, '@kind', 'IFC-klass');
    S.propKeys.forEach(k => option(sel, k, keyLabel(k)));
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '@kind';
  }

  function renderFilters() {
    const box = $('filters');
    box.innerHTML = '';
    S.filters.forEach((f, idx) => {
      const row = document.createElement('div'); row.className = 'frow';
      const ks = document.createElement('select'), vs = document.createElement('select'), rm = document.createElement('button');
      option(ks, '', '(egenskap)');
      const keys = S.propKeys.includes(f.key) || !f.key ? S.propKeys : [f.key].concat(S.propKeys);
      keys.forEach(k => option(ks, k, keyLabel(k)));
      ks.value = f.key;
      option(vs, '', f.key ? '(välj värde)' : '–');
      (f.values || []).forEach(v => option(vs, v, v));
      vs.value = f.value; vs.disabled = !f.key;
      rm.textContent = '✕'; rm.title = 'Ta bort filter'; rm.className = 'ghost';
      ks.addEventListener('change', async () => { f.key = ks.value; f.value = ''; f.values = []; renderFilters(); if (f.key) { f.values = await valuesFor(f.key); renderFilters(); } });
      vs.addEventListener('change', () => { f.value = vs.value; });
      rm.addEventListener('click', () => { S.filters.splice(idx, 1); renderFilters(); });
      row.append(ks, vs, rm);
      box.appendChild(row);
    });
  }

  // Värden som faktiskt finns i modellen. Fallback: värden från urvalet.
  async function valuesFor(key) {
    let vals = [];
    try { const raw = await S.api.valuesForObjectProperty(key); debug('valuesForObjectProperty ' + key, raw); vals = toValueList(raw); } catch (e) { debug('valuesForObjectProperty FEL', e); vals = []; }
    vals = vals.map(v => lastSeg(v)).filter(v => v !== undefined && v !== null && String(v) !== '').map(String);
    if (!vals.length && S.sampled[key]) vals = [...S.sampled[key]];
    return [...new Set(vals)].sort((a, b) => a.localeCompare(b, 'sv', { numeric: true }));
  }

  // ---------- kvantiteter ----------
  function quantities(info, kind) {
    const Q = S.settings.quantities, re = new RegExp(Q.psetPattern), p = info.properties || {}, idx = {};
    Object.entries(p).forEach(([k, v]) => {
      const s = splitKey(k);
      if (s.pset && re.test(s.pset)) { const n = toNum(v); if (n !== null && idx[s.key] === undefined) idx[s.key] = n; }
      else if (!s.pset && re.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
        Object.entries(v).forEach(([kk, vv]) => { const n = toNum(vv); if (n !== null && idx[kk] === undefined) idx[kk] = n; });
      }
    });
    const out = { length: null, area: null, volume: null, src: [] };
    QTY.forEach(t => {
      const cands = (Q.byClass[kind] && Q.byClass[kind][t]) || Q.default[t];
      for (const c of cands) if (idx[c] !== undefined) { out[t] = idx[c] * (Q.scale[t] || 1); out.src.push(`${QNAME[t]}=${c}`); break; }
    });
    return out;
  }

  // ---------- mängdning ----------
  async function run() {
    clearError();
    const kinds = [...S.selKinds];
    if (!kinds.length) { showError('Välj minst en objekttyp.'); return; }
    const scope = $('scopeSel').value;
    if (scope === 'picked' && !S.picked.size) { showError('Klicka på objekt i 3D-vyn först. De samlas som markerade.'); return; }
    const filters = activeFilters().map(f => ({ key: f.key, value: f.value }));
    const groupKey = $('groupSel').value;
    const { pageSize, maxObjects } = S.settings.search;
    $('runBtn').disabled = true;
    $('resultCard').hidden = true;
    let objects = [], truncated = false;
    try {
      for (const kind of kinds) {
        let skip = 0;
        const rules = [groupRules(kind, filters)];
        for (;;) {
          setProgress(`Hämtar ${kindLabel(kind)}… ${objects.length} objekt hittills`);
          const raw = await S.api.getObjectInfoForSearch({ filter: { rules }, page: { limit: pageSize, skip } });
          const page = toObjectList(raw);
          page.forEach(i => {
            const g = guidOf(i);
            if (g) objects.push({ guid: g, name: nameOf(i), kind, props: i.properties || {}, info: i, q: quantities(i, kind) });
          });
          if (objects.length >= maxObjects) { truncated = true; break; }
          if (page.length < pageSize) break;
          skip += pageSize;
        }
        if (truncated) break;
      }
      // dubbletter (om en klass skulle matcha flera gånger)
      const seen = new Set();
      objects = objects.filter(o => !seen.has(o.guid) && seen.add(o.guid));

      if (scope === 'picked') objects = objects.filter(o => S.picked.has(o.guid));
      if (scope === 'layers') objects = await filterVisibleLayers(objects);

      S.objects = objects;
      S.run = { kinds, filters, scope, groupKey, truncated, at: new Date() };
      buildGroups();
      renderResult();
    } catch (e) { showError(e); }
    finally { setProgress(''); $('runBtn').disabled = false; }
  }

  async function filterVisibleLayers(objects) {
    setProgress('Läser synliga lager…');
    const layers = (await S.api.getLayers()) || {};
    const visible = new Set(Object.keys(layers).filter(k => layers[k]));
    const cand = S.settings.layerPropertyCandidates.find(c => objects.some(o => propVal(o.info, c) !== undefined));
    if (!cand) throw 'Kunde inte avgöra vilket lager objekten tillhör. Ingen av egenskaperna i layerPropertyCandidates finns på objekten. Använd "Hela modellen" eller ange rätt egenskap i settings.json.';
    return objects.filter(o => visible.has(String(propVal(o.info, cand))));
  }

  function emptyAgg(name) { return { name, count: 0, length: 0, area: 0, volume: 0, has: { length: 0, area: 0, volume: 0 }, missing: 0, guids: [], kinds: new Set() }; }
  function addTo(a, o) {
    a.count++; a.guids.push(o.guid); a.kinds.add(o.kind);
    let any = false;
    QTY.forEach(t => { if (o.q[t] !== null) { a[t] += o.q[t]; a.has[t]++; any = true; } });
    if (!any) a.missing++;
  }
  function groupValue(o, key) {
    if (key === '@kind') return kindLabel(o.kind);
    const v = propVal(o.info, key);
    return (v === undefined || v === null || String(v) === '') ? MISSING : String(v);
  }
  function buildGroups() {
    const map = new Map(), total = emptyAgg('Totalt');
    S.objects.forEach(o => {
      o.group = groupValue(o, S.run.groupKey);
      if (!map.has(o.group)) map.set(o.group, emptyAgg(o.group));
      addTo(map.get(o.group), o); addTo(total, o);
    });
    S.groups = [...map.values()].sort((a, b) =>
      (a.name === MISSING) - (b.name === MISSING) || a.name.localeCompare(b.name, 'sv', { numeric: true }));
    S.total = total;
  }

  function cell(a, t) { return a.has[t] ? fmt(a[t]) : '–'; }
  function renderResult() {
    const R = S.run;
    $('resultCard').hidden = false;
    $('resultTitle').textContent = `Resultat: ${S.total.count} objekt`;
    $('groupHead').textContent = keyLabel(R.groupKey);
    const tb = $('resultTable').tBodies[0], tf = $('resultTable').tFoot;
    tb.innerHTML = ''; tf.innerHTML = ''; S.selectedRow = null;
    const mkRow = (a, parent, isTotal) => {
      const tr = document.createElement('tr');
      [a.name, String(a.count), cell(a, 'length'), cell(a, 'area'), cell(a, 'volume')].forEach((v, i) => {
        const td = document.createElement('td'); td.textContent = v; if (i) td.className = 'num'; tr.appendChild(td);
      });
      tr.addEventListener('click', () => { [...document.querySelectorAll('#resultTable tr.sel')].forEach(x => x.classList.remove('sel')); tr.classList.add('sel'); S.selectedRow = { agg: a, isTotal }; show3D(); });
      parent.appendChild(tr);
    };
    if (!S.groups.length) {
      const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 5;
      td.textContent = 'Inga objekt matchar urvalet.'; tr.appendChild(td); tb.appendChild(tr);
    }
    S.groups.forEach(g => mkRow(g, tb, false));
    if (S.groups.length) mkRow(S.total, tf, true);

    const warns = [];
    if (R.truncated) warns.push(`Resultatet är avkortat vid ${S.settings.search.maxObjects} objekt. Snäva in filtren.`);
    if (S.total.missing) {
      const per = {};
      S.objects.filter(o => QTY.every(t => o.q[t] === null)).forEach(o => { per[kindLabel(o.kind)] = (per[kindLabel(o.kind)] || 0) + 1; });
      const txt = Object.entries(per).map(([k, n]) => `${k} ${n}`).join(', ');
      warns.push(S.total.missing === S.total.count
        ? `Inga kvantiteter hittades (${txt}). Exportera IFC med baskvantiteter (BaseQuantities/Qto_*). Antal stämmer ändå.`
        : `${S.total.missing} av ${S.total.count} objekt saknar kvantiteter: ${txt}. De räknas i antal men inte i längd, area eller volym.`);
    }
    $('warn').textContent = warns.join(' ');
    $('warn').hidden = !warns.length;
    $('exportBtn').disabled = !S.objects.length;
  }

  // ---------- 3D-koppling (påverkar bara vyn) ----------
  async function show3D() {
    if (!S.selectedRow) return;
    const { agg, isTotal } = S.selectedRow, R = S.run, api = S.api;
    clearError();
    try {
      const canSearch = R.scope === 'model' && (isTotal || agg.name !== MISSING);
      if (canSearch) {
        const kinds = isTotal ? R.kinds : [...agg.kinds];
        const extra = (isTotal || R.groupKey === '@kind') ? [] : [propRule(R.groupKey, agg.name)];
        // Flera klasser: yttre array antas vara ELLER (används bara för 3D-vyn, inte för mängderna)
        const rules = kinds.map(k => groupRules(k, R.filters, extra));
        await api.colorCodeObjects({});
        await api.applyObjectSearch({ filter: { rules }, page: { limit: S.settings.search.maxObjects, skip: 0 } }, true);
        await api.setSearchVisualizationMode(S.mode === 'iso' ? 'HIDDEN' : 'FADED');
        await api.zoomToSearchResult();
      } else {
        // Markerade/lager/saknas: färga exakt de GUID:er som ingår
        const map = {};
        agg.guids.forEach(g => { map[g] = S.settings.highlightColor; });
        await api.resetObjectSearch();
        await api.colorCodeObjects(map);
        if (agg.guids.length === 1) await api.gotoObject(agg.guids[0]);
      }
    } catch (e) { showError(e); }
  }

  async function resetView() {
    clearError();
    [...document.querySelectorAll('#resultTable tr.sel')].forEach(x => x.classList.remove('sel'));
    S.selectedRow = null;
    try {
      await S.api.colorCodeObjects({});
      await S.api.resetObjectSearch();
      await S.api.setSearchVisualizationMode('ORIGINAL');
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
    updatePicked();
  }
  function updatePicked() {
    $('pickedTxt').textContent = `Markerade objekt: ${S.picked.size}. Klicka i 3D för att lägga till eller ta bort.`;
    $('pickedInfo').hidden = $('scopeSel').value !== 'picked';
  }

  // ---------- Excel ----------
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|,]/g, '').trim().replace(/\s+/g, '_') || 'projekt'; }
  const r2 = n => Math.round(n * 1000) / 1000;

  function exportExcel() {
    if (!S.objects.length) return;
    clearError();
    try {
      const R = S.run, XLSX = window.XLSX, gl = keyLabel(R.groupKey);
      const stamp = R.at.toLocaleString('sv-SE');
      const q = (a, t) => a.has[t] ? r2(a[t]) : null;

      const head = [
        [`Mängdning – ${S.projectName}`],
        ['Projekt-ID', S.projectId], ['Byggnads-ID', S.buildingId], ['Mängdat', stamp], ['Användare', S.email],
        ['Objekttyper', R.kinds.map(kindLabel).join(', ')]
      ];
      if (R.filters.length) R.filters.forEach((f, i) => head.push([i ? '' : 'Filter', `${keyLabel(f.key)} = ${f.value}`]));
      else head.push(['Filter', '(inga)']);
      head.push(['Omfång', SCOPE[R.scope]], ['Gruppering', gl]);
      if (R.truncated) head.push(['OBS', `Avkortat vid ${S.settings.search.maxObjects} objekt`]);
      if (S.total.missing) head.push(['OBS', `${S.total.missing} objekt saknar kvantiteter`]);
      head.push([]);
      const hdrRow = head.length;
      head.push([gl, 'Antal (st)', 'Längd (m)', 'Area (m²)', 'Volym (m³)', 'Saknar kvantitet (st)']);
      S.groups.forEach(g => head.push([g.name, g.count, q(g, 'length'), q(g, 'area'), q(g, 'volume'), g.missing]));
      head.push(['Totalt', S.total.count, q(S.total, 'length'), q(S.total, 'area'), q(S.total, 'volume'), S.total.missing]);
      const ws1 = XLSX.utils.aoa_to_sheet(head);
      ws1['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }];
      numFormat(ws1, hdrRow + 1, head.length - 1, [2, 3, 4]);

      const extraKeys = [...new Set([R.groupKey].concat(R.filters.map(f => f.key)).filter(k => k !== '@kind'))];
      const rows = [['GUID', 'Namn', 'IFC-klass'].concat(extraKeys.map(keyLabel), ['Längd (m)', 'Area (m²)', 'Volym (m³)', 'Kvantitetskälla'])];
      S.objects.forEach(o => rows.push([o.guid, o.name, kindLabel(o.kind)]
        .concat(extraKeys.map(k => { const v = propVal(o.info, k); return v === undefined ? '' : v; }),
          [o.q.length === null ? null : r2(o.q.length), o.q.area === null ? null : r2(o.q.area), o.q.volume === null ? null : r2(o.q.volume), o.q.src.join('; ') || 'saknas'])));
      const ws2 = XLSX.utils.aoa_to_sheet(rows);
      ws2['!cols'] = [{ wch: 24 }, { wch: 30 }, { wch: 14 }].concat(extraKeys.map(() => ({ wch: 18 })), [{ wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 34 }]);
      ws2['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
      const qc = 3 + extraKeys.length;
      numFormat(ws2, 1, rows.length - 1, [qc, qc + 1, qc + 2]);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Sammanställning');
      XLSX.utils.book_append_sheet(wb, ws2, 'Objektlista');
      XLSX.writeFile(wb, `${safeName(S.projectName)}_mängdning_${today()}.xlsx`);
    } catch (e) { showError(e); }
  }
  function numFormat(ws, r0, r1, cols) {
    for (let r = r0; r <= r1; r++) cols.forEach(c => {
      const ref = window.XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && ws[ref].t === 'n') ws[ref].z = '#,##0.00';
    });
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
        api.getUserEmail().catch(() => ''), api.getProjectId(), api.getBuildingId()
      ]);
      S.projectName = S.settings.projectNames[S.projectId] || ('projekt-' + S.projectId);
      $('who').textContent = `${S.projectName}${S.email ? ' · ' + S.email : ''}`;

      // Klasser som faktiskt finns i modellen (om API:t svarar), annars hela listan
      let present = [];
      try { const raw = await api.valuesForObjectProperty(S.settings.search.kindKey); debug('valuesForObjectProperty ' + S.settings.search.kindKey, raw); present = toValueList(raw).map(v => String(lastSeg(v))); } catch (e) { debug('valuesForObjectProperty FEL', e); present = []; }
      const norm = k => String(k).replace(/^Ifc/i, '').toLowerCase();
      if (present.length) {
        const pset = new Set(present.map(norm));
        S.classes = S.settings.classes.filter(c => pset.has(norm(c.kind)));
        present.forEach(v => { if (!S.classes.some(c => norm(c.kind) === norm(v))) S.classes.push({ kind: v, label: v.startsWith('Ifc') ? v : 'Ifc' + v }); });
      } else S.classes = S.settings.classes.slice();

      renderChips(); renderGroupSel(); renderFilters(); updatePicked();
      ['classCard', 'filterCard', 'optCard'].forEach(id => { $(id).hidden = false; });
    } catch (e) { showError(e); $('who').textContent = ''; }
  }

  $('clearClassesBtn').addEventListener('click', () => { S.selKinds.clear(); renderChips(); refreshProps(); });
  $('addFilterBtn').addEventListener('click', () => { S.filters.push({ key: '', value: '', values: [] }); renderFilters(); });
  $('clearFiltersBtn').addEventListener('click', () => { S.filters = []; renderFilters(); });
  $('scopeSel').addEventListener('change', updatePicked);
  $('clearPickedBtn').addEventListener('click', () => { S.picked.clear(); updatePicked(); });
  $('runBtn').addEventListener('click', run);
  $('resetViewBtn').addEventListener('click', resetView);
  $('modeMark').addEventListener('click', () => setMode('mark'));
  $('modeIso').addEventListener('click', () => setMode('iso'));
  $('exportBtn').addEventListener('click', exportExcel);

  boot();
})();
