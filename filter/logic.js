// Ren logik för filterwidgeten (testas med node widgets/filter/logic.test.mjs).
//
// Ett villkor är { field, op, values }. Värden i samma villkor räcker var för sig (OR), och alla villkor
// måste stämma (AND). StreamBIM:s sökfilter är tvärtom en OR-lista av AND-grupper, { rules: [[…], […]] },
// så villkoren multipliceras ut.

// Fält som inte är egenskaper i grupper. group = grupperingsnyckel i shared/quantities.js (samma kolumn som sökningen ger).
// Våning = StreamBIM:s 'Location~Floor by position': ett värde per objekt, sökbart och färgbart, så att tabell,
// nedborrning och färgning räknar lika. ('Floor Id' kan ge ett objekt flera våningar, Revits nivå är inte sökbar.)
const FLOOR = { key: 'Location~Floor by position', label: 'Floor', base: { psetName: 'Location', propKey: 'Floor by position' }, group: 'floor' };
export const FIELDS = {
  '@kind': { key: '@kind', label: 'IFC type', base: { propKey: '@kind' }, group: '@kind' },
  [FLOOR.key]: FLOOR,
  'Floor Id': FLOOR, // äldre sparade vyer
  'Type Name': { key: 'Type Name', label: 'Type name', base: { propKey: 'Type Name' }, group: 'Type Name' },
  'Name': { key: 'Name', label: 'Name', base: { propKey: 'Name' }, group: 'Name' },
};

// 'Grupp~Nyckel' → fält för en egenskap.
export function fieldOf(key) {
  if (FIELDS[key]) return FIELDS[key];
  const i = key.indexOf('~');
  return { key, label: key.slice(i + 1), sub: key.slice(0, i), base: { psetName: key.slice(0, i), propKey: key.slice(i + 1) }, group: key };
}
export const labelOf = (f) => (f.sub ? `${f.label} (${f.sub})` : f.label);

export const OPS = [['=', 'is'], ['!=', 'is not'], ['contains', 'contains'], ['startsWith', 'starts with'],
  ['>', 'greater than'], ['<', 'less than'], ['hasValue', 'has a value']];

// Nytt villkor, eller ett värde till i ett befintligt (samma fält och jämförelse → något av värdena).
export function addCond(conds, field, op, value) {
  const same = conds.find((c) => c.field.key === field.key && c.op === op);
  if (same && op !== 'hasValue') {
    if (!same.values.includes(value)) same.values.push(value);
    return conds;
  }
  return [...conds, { field, op, values: op === 'hasValue' ? [] : [value] }];
}

export function buildFilter(conds, { buildingId, max = 64 }) {
  const rule = (f, op, v) => ({ buildingId, ...f.base, operator: op, ...(op !== 'hasValue' && { propValue: v }) });
  let groups = [[]];
  for (const c of conds) {
    if (c.op === 'hasValue') { groups = groups.map((g) => [...g, rule(c.field, 'hasValue')]); continue; }
    if (!c.values.length) continue;
    // "är inte A eller B" betyder varken A eller B: alla måste gälla.
    if (c.op === '!=') { groups = groups.map((g) => [...g, ...c.values.map((v) => rule(c.field, '!=', v))]); continue; }
    groups = groups.flatMap((g) => c.values.map((v) => [...g, rule(c.field, c.op, v)]));
  }
  groups = groups.filter((g) => g.length);
  if (!groups.length) return null;
  if (groups.length > max) throw new Error(`Too many combinations (${groups.length}). Remove some values.`);
  return { rules: groups };
}

// Lägg till ett villkor i varje AND-grupp.
export const and = (filter, rule) => ({ rules: filter.rules.map((g) => [...g, rule]) });

// Värdeindex: { keys: { 'Grupp~Nyckel': { values: { värde: antal } } } } → träffar för en söktext.
// Exakt träff först, sedan värden som börjar med texten, sedan övriga. Inom varje nivå flest objekt först.
export function searchValues(index, text, limit = 8) {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const hits = [];
  for (const [key, entry] of Object.entries(index?.keys ?? {})) {
    for (const [value, n] of Object.entries(entry.values ?? {})) {
      const v = value.toLowerCase();
      const at = v.indexOf(t);
      if (at < 0) continue;
      hits.push({ key, value, n, rank: v === t ? 0 : at === 0 ? 1 : 2 });
    }
  }
  return hits.sort((a, b) => a.rank - b.rank || b.n - a.n || a.value.localeCompare(b.value, 'sv')).slice(0, limit);
}

// Sparade vyer: villkor, uppdelning, mått och visning som ren data (localStorage), och tillbaka.
export const toView = (name, conds, groupBy, { measure = 'count', display = 'donut', max = 8 } = {}) =>
  ({ name, conds: conds.map((c) => ({ key: c.field.key, op: c.op, values: [...c.values] })), groupBy: groupBy?.key, measure, display, max });
export const fromView = (view) => ({
  conds: view.conds.map((c) => ({ field: fieldOf(c.key), op: c.op, values: [...c.values] })),
  groupBy: view.groupBy ? fieldOf(view.groupBy) : null,
  measure: view.measure ?? 'count',
  display: view.display === 'share' ? 'donut' : view.display ?? 'donut', // 'share' = äldre namn
  max: view.max ?? 8,
});

// Diagram: de n största, resten ihopslagna till "Other". Ordnade grupper (våningar) behåller ordningen.
export function fold(items, n, { ordered = false, other = 'Other' } = {}) {
  const list = ordered ? [...items] : [...items].sort((a, b) => b.v - a.v);
  if (list.length <= n) return list;
  const keep = ordered ? list.filter((g) => [...items].sort((a, b) => b.v - a.v).slice(0, n - 1).includes(g)) : list.slice(0, n - 1);
  const rest = list.filter((g) => !keep.includes(g));
  return [...keep, { label: other, v: rest.reduce((s, g) => s + g.v, 0), other: true }];
}

// Förslag på namn: "Dörr, Fönster · Plan 04". show översätter värden (t.ex. IFC-typ till svenska).
export const viewName = (conds, show = (f, v) => v) =>
  conds.map((c) => (c.values.length ? c.values.map((v) => show(c.field, v)).join(', ') : labelOf(c.field))).join(' · ');
