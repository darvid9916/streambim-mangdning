// Ren mängdlogik utan StreamBIM-anslutning, så att den kan testas med node (quantities.test.mjs).
// Indata är StreamBIM:s getObjectInfo-svar (format: se widgets/shared/streambim.js och README).
//
// Flöde: ObjectInfo[] → prepare() → filterObjects() → summarize(groupBy) → toTSV()
import { propsOf, guidOf, TO_METRE } from './streambim.js';

export const TYPE_KEY = 'Type Object Global Id';
export const KIND_KEY = '@kind';

// Kategorier att söka på (StreamBIM:s @kind), A/K först.
export const KINDS = [
  ['Wall', 'Väggar'], ['Slab', 'Bjälklag'], ['Space', 'Rum och zoner'], ['Door', 'Dörrar'], ['Window', 'Fönster'],
  ['Covering', 'Beklädnad/undertak'], ['Roof', 'Tak'], ['Column', 'Pelare'], ['Beam', 'Balkar'],
  ['Stair', 'Trappor'], ['Railing', 'Räcken'], ['Curtain wall', 'Glasfasader'], ['Member', 'Profiler'],
  ['Plate', 'Skivor'], ['Footing', 'Fundament'], ['Pile', 'Pålar'],
];

// Mängdnamn i prioritetsordning. IFC-standardmängder (Qto/BaseQuantities) vinner, sedan Revits egenskaper (t.ex. BIP~Area).
// Längder kommer i meter: propsOf räknar om med StreamBIM:s egen enhetsangivelse.
export const DIMENSIONS = {
  area:   { label: 'Area',   unit: 'm²', names: ['NetSideArea', 'NetFloorArea', 'NetArea', 'GrossSideArea', 'GrossFloorArea', 'GrossArea', 'Area'] },
  length: { label: 'Length', unit: 'm',  names: ['Length', 'NetPerimeter', 'GrossPerimeter', 'Perimeter'] },
  volume: { label: 'Volume', unit: 'm³', names: ['NetVolume', 'GrossVolume', 'Volume'] },
};

// StreamBIM:s egen våning först: den går att söka och färga på (se widgets/filter/logic.js).
const STOREY_NAMES = ['Floor by position', '@Building Storey~Name', 'StoreyName', 'Base Constraint', 'Level'];
const TYPE_NAMES = ['TypeID', 'Type~Name', 'Type Name', 'Family and Type', 'ObjectType', 'Name'];
const QTO_PSET = /^(Qto_|BaseQuantities~)/;
// Täcks redan av grupperingarna Våning och Typ, eller är id:n.
const BUILT_IN = new Set([TYPE_KEY, 'Global Id', 'Name', '@Building Storey~Name', '@Building Storey~@iid', 'Type~Name', '@Document Id', 'Timestamp',
  'StoreyName', 'Floor by position', 'Base Constraint', 'Level', 'TypeID', 'Type Name', 'Family and Type', 'ObjectType']);
export const UNKNOWN_FLOOR = 'Unknown floor';
export const MISSING = '(missing)';

// Värden som 'T~<guid>' (Type Object Global Id) → '<guid>'.
const scalar = (v) => {
  v = Array.isArray(v) ? v[0] : v;
  return typeof v === 'string' ? v.split('~').pop().trim() : v;
};

// Nyckel för ett egenskapsnamn: exakt ('Type~Name') eller 'grupp~namn'. Qto-grupp vinner om flera finns.
function findKey(p, name) {
  let hit;
  for (const k of Object.keys(p)) {
    if (k !== name && !k.endsWith('~' + name)) continue;
    if (QTO_PSET.test(k)) return k;
    hit ??= k;
  }
  return hit;
}

export function text(p, name) {
  const v = scalar(p[findKey(p, name)]);
  return v === undefined || v === null || v === '' ? undefined : String(v);
}

export function num(v) {
  v = scalar(v);
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const first = (p, names) => names.map((n) => text(p, n)).find(Boolean);

export function typeOf(info) {
  const p = propsOf(info);
  return { guid: text(p, TYPE_KEY), name: first(p, TYPE_NAMES) ?? 'Unknown type', description: text(p, 'TypeDescription') };
}

// ObjectInfo[] → [{ guid, p, floor, type }]. floorNames: våningar i ordning från getFloors().
export const prepare = (infos) => fromProps(infos.map((i) => [guidOf(i), propsOf(i)]));

// Sökrader med fieldUnion (se searchRows) → samma form. Längder i mm/cm/dm räknas om till meter enligt header.
export function prepareRows({ header = [], rows = [] }) {
  const scale = header.filter((c) => TO_METRE[c.unit]).map((c) => [c.id, TO_METRE[c.unit]]);
  return fromProps(rows.map((r) => {
    const p = { ...r, '@kind': r['IFC Type'] };
    for (const [k, s] of scale) { const v = num(p[k]); if (v !== null) p[k] = v * s; }
    return [r.GUID, p];
  }));
}

// Våningen som den står: 'PLAN 11' och 'Plan 11' är olika våningar i StreamBIM (getFloors har båda).
function fromProps(pairs) {
  return pairs.map(([guid, p]) => ({ guid, p, floor: first(p, STOREY_NAMES) ?? UNKNOWN_FLOOR, type: first(p, TYPE_NAMES) ?? 'Unknown type' }));
}

// Fritext matchar alla textvärden (skiftlägesokänsligt); floor = '' betyder alla våningar.
export function filterObjects(objs, { floor = '', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return objs.filter((o) => (!floor || o.floor === floor)
    && (!q || Object.values(o.p).some((v) => typeof scalar(v) === 'string' && scalar(v).toLowerCase().includes(q))));
}

// Vad man kan gruppera på: våning, typ, och textegenskaper som faktiskt delar upp mängden
// (minst 2 olika värden, och inte unika per objekt som GUID:er och namn).
export function groupOptions(objs, maxDistinct = 60) {
  const distinct = {};
  for (const o of objs) for (const [k, v] of Object.entries(o.p)) {
    const s = scalar(v);
    // StreamBIM levererar allt som text – tal ('12.5') är mängder, inte grupper.
    if (typeof s === 'string' && s && !Number.isFinite(Number(s))) (distinct[k] ??= new Set()).add(s);
  }
  const props = Object.entries(distinct)
    .filter(([k, s]) => !BUILT_IN.has(k) && !BUILT_IN.has(k.split('~').pop()) && s.size >= 2 && s.size <= maxDistinct && s.size < objs.length)
    .map(([k]) => { const i = k.lastIndexOf('~'); return { key: k, label: i < 0 ? k : `${k.slice(i + 1)} (${k.slice(0, i)})` }; })
    .sort((a, b) => a.label.localeCompare(b.label, 'sv'));
  return [{ key: 'floor', label: 'Våning' }, { key: 'type', label: 'Typ' }, ...props];
}

const groupOf = (o, groupBy) =>
  groupBy === 'floor' ? o.floor : groupBy === 'type' ? o.type : text(o.p, groupBy) ?? MISSING;

// Returnerar { groups, dims, guids } där dims.count alltid finns och area/length/volume bara om någon har värdet.
export function summarize(objs, groupBy = 'floor', floorNames = []) {
  const blank = (unit, label) => ({ label, unit, total: 0, source: null, missing: [], byGroup: {}, byObject: {} });
  const add = (d, g, v) => { d.total += v; d.byGroup[g] = (d.byGroup[g] ?? 0) + v; };
  const guids = {};
  const groupFor = new Map(objs.map((o) => [o, groupOf(o, groupBy)]));

  const dims = { count: blank('pcs', 'Count') };
  for (const o of objs) {
    const g = groupFor.get(o);
    add(dims.count, g, 1);
    (guids[g] ??= []).push(o.guid);
  }

  // Ett mängdnamn per IFC-typ, så att netto och brutto inte blandas inom en typ (väggar NetSideArea, bjälklag NetArea).
  // En typ som helt saknar måttet räknas inte som bortfall – måttet gäller inte den (dörrar har ingen längd).
  const byKind = new Map();
  for (const o of objs) { const k = text(o.p, KIND_KEY) ?? ''; (byKind.get(k) ?? byKind.set(k, []).get(k)).push(o); }
  for (const [dim, { label, unit, names }] of Object.entries(DIMENSIONS)) {
    const sources = new Set();
    let d = null;
    for (const group of byKind.values()) {
      const name = names.find((n) => group.some((o) => num(o.p[findKey(o.p, n)]) !== null));
      if (!name) continue;
      d ??= dims[dim] = blank(unit, label);
      for (const o of group) {
        const key = findKey(o.p, name);
        const v = num(o.p[key]);
        if (v === null) { d.missing.push(o.guid); continue; }
        sources.add(key);
        d.byObject[o.guid] = v;
        add(d, groupFor.get(o), v);
      }
    }
    if (d) d.source = [...sources].join(', ');
  }

  // Våningar i getFloors-ordning; annars bokstavsordning. Okänd/saknas alltid sist.
  const order = floorNames.map((f) => f.toLowerCase());
  const rank = (g) => {
    if (g === UNKNOWN_FLOOR || g === MISSING) return 2e9;
    const i = groupBy === 'floor' ? order.indexOf(g.toLowerCase()) : -1;
    return i < 0 ? 1e9 : i;
  };
  const groups = Object.keys(dims.count.byGroup)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'sv', { numeric: true }));
  return { groups, dims, guids };
}

// Tabbseparerat med svenska decimalkomman – klistras rakt in i Excel.
export function toTSV({ groups, dims }, groupLabel) {
  const cols = ['count', 'area', 'length', 'volume'].filter((k) => dims[k]);
  const n = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
  const head = [groupLabel, ...cols.map((k) => `${dims[k].label} (${dims[k].unit})`)];
  const rows = groups.map((g) => [g, ...cols.map((k) => n(dims[k].byGroup[g] ?? 0))]);
  const total = ['Total', ...cols.map((k) => n(dims[k].total))];
  return [head, ...rows, total].map((r) => r.join('\t')).join('\n');
}
