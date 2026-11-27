/* Demoläge: efterliknar StreamBIM.API med påhittade objekt (?mock=1).
 * Används aldrig när widgeten körs inifrån StreamBIM. */
(function () {
  'use strict';
  const objs = [];
  const floors = ['Plan 1', 'Plan 2', 'Plan 3'];
  const zones = ['A', 'B'];
  let n = 0;
  function add(kind, name, type, material, floor, zone, layer, qto) {
    n++;
    const p = {
      '@kind': ['Ifc' + kind], '@layer': [layer], 'Name': [name], 'GUID': ['MOCK-' + n], 'Type': [type], 'Material': [material],
      'Building Storey': [floor], 'Platsdata~Zon': [zone], 'Platsdata~Byggdel': [type.split(' ')[0]]
    };
    Object.entries(qto || {}).forEach(([k, v]) => { p[k] = [v]; });
    objs.push({ guid: 'MOCK-' + n, name, center: [n % 20, (n * 3) % 15, floors.indexOf(floor) * 3.6], properties: p });
  }
  floors.forEach((f, fi) => zones.forEach(z => {
    for (let i = 0; i < 6; i++) {
      const ext = i < 2, len = 3 + ((i * 7 + fi) % 5) * 0.8, h = 3.4, t = ext ? 0.3 : 0.12;
      add('Wall', `Vägg ${f.slice(-1)}${z}-${i + 1}`, ext ? 'YV1 Betong 300' : 'IV2 Gips 120', ext ? 'Betong C30/37' : 'Gips', f, z, 'A-modell',
        { 'BaseQuantities~Length': len, 'BaseQuantities~NetSideArea': +(len * h * 0.9).toFixed(3), 'BaseQuantities~NetVolume': +(len * h * t * 0.9).toFixed(3) });
    }
    for (let i = 0; i < 4; i++) {
      const type = i % 2 ? 'D10 Innerdörr 9x21' : 'D20 Branddörr EI30 10x21';
      add('Door', `Dörr ${f.slice(-1)}${z}0${i + 1}`, type, 'Trä', f, z, 'A-modell',
        i === 3 ? {} : { 'Qto_DoorBaseQuantities~Area': i % 2 ? 1.89 : 2.1, 'Qto_DoorBaseQuantities~Width': i % 2 ? 0.9 : 1.0, 'Qto_DoorBaseQuantities~Height': 2.1 });
    }
    add('Slab', `Bjälklag ${f.slice(-1)}${z}`, 'BJ1 Betong 250', 'Betong C30/37', f, z, 'K-modell',
      { 'Qto_SlabBaseQuantities~NetArea': 180 + fi * 5, 'Qto_SlabBaseQuantities~GrossArea': 190 + fi * 5, 'Qto_SlabBaseQuantities~NetVolume': +((180 + fi * 5) * 0.25).toFixed(2), 'Qto_SlabBaseQuantities~Width': 0.25 });
    for (let i = 0; i < 3; i++)
      add('Column', `Pelare ${f.slice(-1)}${z}-${i + 1}`, 'P1 Betong 400x400', 'Betong C35/45', f, z, 'K-modell',
        { 'BaseQuantities~Length': 3.35, 'BaseQuantities~NetVolume': +(0.16 * 3.35).toFixed(3) });
  }));

  const key = r => r.psetName ? r.psetName + '~' + r.propKey : r.propKey;
  const val = (o, k) => (o.properties[k] || [])[0];
  // Efterliknar ett strängare API: @kind kräver formatet IfcXxx och operator '='
  function ruleOk(o, r) {
    if (r.propKey === '@kind' && r.operator !== '=') return false;
    return String(val(o, key(r))) === String(r.propValue);
  }
  function match(o, q) {
    if (q.key) return String(val(o, q.key)) === String(q.value);
    const groups = (q.filter && q.filter.rules) || [];
    return !groups.length || groups.some(g => g.every(r => ruleOk(o, r)));
  }
  const log = (...a) => console.log('[mock StreamBIM]', ...a);

  window.StreamBIMMock = {
    create(cb) {
      window.__mockPick = guid => cb.pickedObject && cb.pickedObject({ guid, point: [0, 0, 0] });
      return {
        getUserEmail: async () => 'daniel.arvidsson@sweco.se',
        getProjectId: async () => '5364',
        getBuildingId: async () => '1000',
        valuesForObjectProperty: async (p) => { const o = {}; objs.forEach(x => { const v = val(x, p); if (v !== undefined) o[v] = (o[v] || 0) + 1; }); return o; },
        getObjectInfoForSearch: async (q) => {
          const all = objs.filter(o => match(o, q)), pg = q.page || { limit: 1000, skip: 0 };
          await new Promise(r => setTimeout(r, 60));
          return { data: all.slice(pg.skip, pg.skip + pg.limit) };
        },
        getLayers: async () => ({ 'A-modell': true, 'K-modell': true }),
        setLayers: async (m) => { log('setLayers', JSON.stringify(m)); return true; },
        hideObject: async () => true,
        showAllObjects: async () => { log('showAllObjects'); return true; },
        applyObjectSearch: async (q) => { const r = objs.filter(o => match(o, q)).map(o => o.guid); log('applyObjectSearch', JSON.stringify(q.filter.rules), '→', r.length); return r; },
        setSearchVisualizationMode: async (m) => { log('mode', m); return true; },
        zoomToSearchResult: async () => true,
        resetObjectSearch: async () => { log('resetObjectSearch'); return true; },
        colorCodeObjects: async (m) => { log('colorCodeObjects', Object.keys(m).length); return true; },
        gotoObject: async (g) => { log('gotoObject', g); return true; }
      };
    }
  };
})();
