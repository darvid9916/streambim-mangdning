// Kör: node widgets/shared/xlsx.test.mjs  (packar upp zip-filen själv och kontrollerar CRC mot node:zlib)
import assert from 'node:assert/strict';
import { crc32 as zcrc } from 'node:zlib';
import { xlsx, crc32, sheetNames } from './xlsx.js';

const bytes = xlsx([
  { name: 'Summary', rows: [['Floor', 'Count', 'Area (m²)'], ['Plan 01', 12, 3.5], ['A & <B>', null, 0]] },
  { name: 'Summary', rows: [['x']] },
]);

const dv = new DataView(bytes.buffer);
const files = {};
for (let at = 0; dv.getUint32(at, true) === 0x04034b50;) {
  const size = dv.getUint32(at + 18, true), n = dv.getUint16(at + 26, true);
  const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + n));
  const data = bytes.subarray(at + 30 + n, at + 30 + n + size);
  assert.equal(dv.getUint32(at + 14, true), zcrc(data), `crc ${name}`);
  files[name] = new TextDecoder().decode(data);
  at += 30 + n + size;
}
assert.deepEqual(Object.keys(files), ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
const s1 = files['xl/worksheets/sheet1.xml'];
assert.ok(s1.includes('<c r="B2"><v>12</v></c>'));
assert.ok(s1.includes('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Floor</t></is></c>'));
assert.ok(s1.includes('A &amp; &lt;B&gt;'));
assert.ok(!s1.includes('r="B3"'), 'tom cell utelämnas');
assert.ok(files['xl/workbook.xml'].includes('name="Summary 2"'));
assert.equal(crc32(new TextEncoder().encode('abc')), zcrc('abc'));
assert.deepEqual(sheetNames(['a/b', 'x'.repeat(40), 'X'.repeat(40)]), ['a b', 'x'.repeat(31), `${'X'.repeat(29)} 2`]);
// Slutposten pekar på centralkatalogen
const end = bytes.length - 22;
assert.equal(dv.getUint32(end, true), 0x06054b50);
assert.equal(dv.getUint16(end + 10, true), 7);
assert.equal(dv.getUint32(dv.getUint32(end + 16, true), true), 0x02014b50);
console.log('xlsx: ok');
