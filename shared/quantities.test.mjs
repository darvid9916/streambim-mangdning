// Kör: node widgets/shared/quantities.test.mjs
import assert from 'node:assert/strict';
import { prepare, summarize, filterObjects, groupOptions, toTSV, typeOf, num, UNKNOWN_FLOOR, MISSING } from './quantities.js';
import { propsOf } from '../shared/streambim.js';

// StreamBIM:s getObjectInfo-format, som det såg ut i projekt 5364 (förenklat).
const info = (guid, { storey, type = 'T1', typeName = 'Basic Wall:IV02', groups = {} } = {}) => ({
  properties: {
    '@kind': 'Wall', Name: `Vägg ${guid}`, 'Global Id': guid, 'Type Object Global Id': `T~${type}`,
    ...(storey && { '@Building Storey': { '@iid': '1', Name: storey } }),
  },
  groups: [
    { label: 'Type', content: { properties: [{ key: 'Name', value: typeName }] } },
    ...Object.entries(groups).map(([label, props]) => ({ label, content: { properties: props.map(([key, value, unit]) => ({ key, value: String(value), ...(unit && { unit }) })) } })),
  ],
});
const area = (v) => ({ BIP: [['Area', v, 'square_metre']] });

const infos = [
  info('a', { storey: 'Plan 02', groups: { ...area(10), Ytskikt: [['Finish', 'Målad']] } }),
  info('b', { storey: 'Plan 01', groups: { BIP: [['Area', '2.5', 'square_metre']], Ytskikt: [['Finish', 'Kakel']] } }),
  info('c', { storey: 'Plan 01', type: 'T2', typeName: 'Basic Wall:YV05', groups: { ...area(7.5), Ytskikt: [['Finish', 'Målad']] } }),
  info('d', { storey: 'Plan 01' }),                 // saknar area → bortfall, men räknas i antal
  info('e', { storey: 'TAK', groups: area(1) }),    // våning som inte finns i getFloors
  { properties: { 'Global Id': 'f' }, groups: [{ label: 'BIP', content: { properties: [{ key: 'Area', value: '4' }] } }] }, // ingen våning, ingen typ
];
const floorNames = ['Plan 01', 'Plan 02'];
const objs = prepare(infos, floorNames);

// --- Gruppering per våning
const s = summarize(objs, 'floor', floorNames);
assert.deepEqual(s.groups, ['Plan 01', 'Plan 02', 'TAK', UNKNOWN_FLOOR]);
assert.equal(s.dims.count.total, 6);
assert.equal(s.dims.area.total, 25);
assert.deepEqual(s.dims.area.byGroup, { 'Plan 01': 10, 'Plan 02': 10, TAK: 1, [UNKNOWN_FLOOR]: 4 });
assert.deepEqual(s.dims.area.missing, ['d']);
assert.equal(s.dims.area.source, 'BIP~Area');
assert.equal(s.dims.volume, undefined);
assert.deepEqual(s.guids['Plan 01'], ['b', 'c', 'd']);

// --- Typ och godtycklig egenskap
assert.deepEqual(summarize(objs, 'type').dims.area.byGroup, { 'Basic Wall:IV02': 13.5, 'Basic Wall:YV05': 7.5, 'Unknown type': 4 });
const y = summarize(objs, 'Ytskikt~Finish');
assert.deepEqual(y.groups, ['Kakel', 'Målad', MISSING]);
assert.equal(y.dims.area.byGroup['Målad'], 17.5);

// --- Filter
assert.deepEqual(filterObjects(objs, { floor: 'Plan 01' }).map((o) => o.guid), ['b', 'c', 'd']);
assert.deepEqual(filterObjects(objs, { query: 'KAKEL' }).map((o) => o.guid), ['b']);

// --- Grupperingsval: Ytskikt ja; våning, typnamn, id:n och tal nej
const opts = groupOptions(objs).map((o) => o.key);
assert.deepEqual(opts.slice(0, 2), ['floor', 'type']);
assert.ok(opts.includes('Ytskikt~Finish'));
for (const k of ['@Building Storey~Name', 'Type~Name', 'Type Object Global Id', 'Global Id', 'BIP~Area']) assert.ok(!opts.includes(k), k);

// --- Export till Excel
assert.equal(toTSV(y, 'Finish (Ytskikt)'), [
  'Finish (Ytskikt)\tCount (pcs)\tArea (m²)',
  'Kakel\t1\t2,5',
  'Målad\t2\t17,5',
  `${MISSING}\t3\t5`,
  'Total\t6\t25',
].join('\n'));

// --- BaseQuantities vinner över Revit-egenskap; längd i mm räknas om till m via StreamBIM:s enhet
const q = summarize(prepare([{ properties: { 'Global Id': 'x' }, groups: [
  { label: 'BIP', content: { properties: [{ key: 'Area', value: '99', unit: 'square_metre' }] } },
  { label: 'BaseQuantities', content: { properties: [
    { key: 'NetArea', value: '12', unit: 'square_metre' }, { key: 'Perimeter', value: '3000', unit: 'millimetre' }] } },
] }]));
assert.equal(q.dims.area.total, 12);
assert.equal(q.dims.area.source, 'BaseQuantities~NetArea');
assert.equal(q.dims.length.total, 3);

// --- Typ, tal och platta egenskaper
assert.deepEqual(typeOf(infos[0]), { guid: 'T1', name: 'Basic Wall:IV02', description: undefined });
assert.equal(num(['12.5 m²']), 12.5);
assert.equal(num('abc'), null);
assert.equal(propsOf(infos[0])['@Building Storey~Name'], 'Plan 02');

console.log('quantities: ok');

// fieldUnion-rader: mm → m, null räknas som saknat, IFC Type blir @kind
{
  const { prepareRows } = await import('./quantities.js');
  const header = [{ id: 'BIP~Length', unit: 'millimetre' }, { id: 'BIP~Area', unit: 'square_metre' }];
  const rows = [
    { GUID: 'a', 'IFC Type': 'Wall', 'Location~Floor by position': 'PLAN 11', 'BIP~StoreyName': 'Plan 01', 'BIP~Length': 2500, 'BIP~Area': 7.5 },
    { GUID: 'b', 'IFC Type': 'Wall', 'BIP~StoreyName': 'Plan 02', 'BIP~Length': null, 'BIP~Area': '2,5' },
  ];
  const o = prepareRows({ header, rows });
  // StreamBIM:s egen våning vinner över Revits, och skiftläget behålls (sökningen skiljer på dem)
  assert.deepEqual(o.map((x) => x.floor), ['PLAN 11', 'Plan 02']);
  const r = summarize(o, '@kind');
  assert.equal(r.dims.length.total, 2.5);
  assert.deepEqual(r.dims.length.missing, ['b']);
  assert.equal(r.dims.area.total, 10);
  assert.deepEqual(r.groups, ['Wall']);
  console.log('prepareRows: ok');
}

// Mängdnamn per IFC-typ: väggar NetSideArea, bjälklag NetArea; dörrar utan längd är inget bortfall
{
  const { prepareRows } = await import('./quantities.js');
  const rows = [
    { GUID: 'w', 'IFC Type': 'Wall', 'BaseQuantities~NetSideArea': 10, 'BaseQuantities~Length': 4 },
    { GUID: 's', 'IFC Type': 'Slab', 'BaseQuantities~NetArea': 50 },
    { GUID: 'd', 'IFC Type': 'Door', 'BIP~Area': 2 },
  ];
  const r = summarize(prepareRows({ rows }), '@kind');
  assert.equal(r.dims.area.total, 62);
  assert.equal(r.dims.area.byGroup.Slab, 50);
  assert.equal(r.dims.length.total, 4);
  assert.deepEqual(r.dims.length.missing, []);
  assert.equal(r.dims.area.source, 'BaseQuantities~NetSideArea, BaseQuantities~NetArea, BIP~Area');
  console.log('mängd per IFC-typ: ok');
}
