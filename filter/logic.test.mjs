// Kör: node widgets/filter/logic.test.mjs
import assert from 'node:assert/strict';
import { FIELDS, fieldOf, addCond, buildFilter, and, searchValues } from './logic.js';

const ctx = { buildingId: '1000' };
const door = (op = '=') => ({ buildingId: '1000', propKey: '@kind', operator: op, propValue: 'Door' });

// Egenskap i grupp
assert.deepEqual(fieldOf('_ARK_Prod~4.2 Öppningssätt').base, { psetName: '_ARK_Prod', propKey: '4.2 Öppningssätt' });

// Samma fält → OR, olika fält → AND, utmultiplicerat
let conds = addCond([], FIELDS['@kind'], '=', 'Door');
conds = addCond(conds, fieldOf('_ARK_Prod~4.2 Öppningssätt'), '=', 'GP');
conds = addCond(conds, fieldOf('_ARK_Prod~4.2 Öppningssätt'), '=', 'UP');
conds = addCond(conds, FIELDS['Floor Id'], '=', 'Plan 04'); // äldre nyckel → samma våningsfält
assert.equal(conds.length, 3);
const f = buildFilter(conds, ctx);
assert.equal(f.rules.length, 2);
assert.deepEqual(f.rules[1], [door(),
  { buildingId: '1000', psetName: '_ARK_Prod', propKey: '4.2 Öppningssätt', operator: '=', propValue: 'UP' },
  { buildingId: '1000', psetName: 'Location', propKey: 'Floor by position', operator: '=', propValue: 'Plan 04' }]);
assert.equal(FIELDS['Floor Id'], fieldOf('Location~Floor by position'));

// "är inte" med flera värden → alla i samma grupp; "har värde" saknar propValue
const neg = buildFilter([{ field: FIELDS['@kind'], op: '!=', values: ['Door', 'Wall'] }, { field: FIELDS['Name'], op: 'hasValue', values: [] }], ctx);
assert.equal(neg.rules.length, 1);
assert.equal(neg.rules[0].length, 3);
assert.ok(!('propValue' in neg.rules[0][2]));

assert.equal(buildFilter([], ctx), null);
assert.throws(() => buildFilter([{ field: FIELDS['Name'], op: '=', values: ['a', 'b', 'c'] }, { field: FIELDS['@kind'], op: '=', values: ['x', 'y', 'z'] }], { ...ctx, max: 8 }));
assert.deepEqual(and({ rules: [[door()], [door('!=')]] }, 'R').rules, [[door(), 'R'], [door('!='), 'R']]);

// Värdesökning: exakt, början, mitten
const index = { keys: { 'A~x': { values: { GP: 24, 'GP-01': 3, AGPX: 50 } }, 'B~y': { values: { gp: 2, GE: 400 } } } };
assert.deepEqual(searchValues(index, 'gp').map((h) => h.value), ['GP', 'gp', 'GP-01', 'AGPX']);
assert.deepEqual(searchValues(index, ' '), []);



// Sparad vy fram och tillbaka
{
  const { toView, fromView, viewName } = await import('./logic.js');
  const c = [{ field: FIELDS['@kind'], op: '=', values: ['Door'] }, { field: fieldOf('_ARK_Prod~4.2 Öppningssätt'), op: '=', values: ['GP', 'UP'] }];
  const v = JSON.parse(JSON.stringify(toView('Mina dörrar', c, FIELDS['Floor Id'])));
  const back = fromView(v);
  assert.deepEqual(back.conds, c);
  assert.equal(back.groupBy, FIELDS['Floor Id']);
  assert.equal(viewName(c, (f, x) => (x === 'Door' ? 'Dörr' : x)), 'Dörr · GP, UP');
  assert.equal(back.measure, 'count');
  assert.deepEqual(fromView(toView('x', c, null, { measure: 'area', display: 'columns', max: 12 })).display, 'columns');
  assert.equal(fromView({ conds: [], display: 'share' }).display, 'donut');
  assert.equal(fromView({ conds: [] }).max, 8);
  console.log('vyer: ok');
}
{
  const { fold } = await import('./logic.js');
  const g = [{ label: 'a', v: 1 }, { label: 'b', v: 5 }, { label: 'c', v: 3 }, { label: 'd', v: 2 }];
  assert.deepEqual(fold(g, 3).map((x) => [x.label, x.v]), [['b', 5], ['c', 3], ['Other', 3]]);
  assert.deepEqual(fold(g, 3, { ordered: true }).map((x) => x.label), ['b', 'c', 'Other']);
  assert.deepEqual(fold(g, 4, { ordered: true }).map((x) => x.label), ['a', 'b', 'c', 'd']);
  console.log('fold: ok');
}
console.log('filterlogik: ok');
