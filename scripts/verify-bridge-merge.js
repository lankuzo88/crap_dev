'use strict';
// Verify mergeClinicalBridges on the 4 known cases by loading the function
// from admin.html (same logic in dashboard.html and dashboard_mobile_terracotta.html).

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

process.chdir(path.join(__dirname, '..'));

function loadFunction(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${file} missing ${name}()`);
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') depth -= 1;
    if (depth === 0) { end = i + 1; break; }
  }
  const fnSource = src.slice(start, end);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${fnSource}\nthis.fn = ${name};`, sandbox);
  return sandbox.fn;
}

const merge = loadFunction('admin.html', 'mergeClinicalBridges');

function productBridge(raw, teeth) {
  return { product: { name: `Cầu R${raw}`, groups: [{ type: 'bridge', teeth, raw }] }, group: { type: 'bridge', teeth, raw } };
}

const cases = [
  {
    label: '260505070-4',
    product: [productBridge('24-25', ['24','25']), productBridge('26-27', ['26','27'])],
    clinical: [{ from: '24', to: '27', teeth: ['24','25','26','27'] }],
    expectBridges: ['24-27'],
  },
  {
    label: '261205067-1',
    product: [productBridge('33-31', ['33','32','31']), productBridge('44-46', ['44','45','46'])],
    clinical: [{ from: '43', to: '46', teeth: ['43','44','45','46'] }],
    expectBridges: ['33-31', '43-46'],
  },
  {
    label: '262105032-1',
    product: [
      productBridge('13-23', ['13','12','11','21','22','23']),
      productBridge('14-15', ['14','15']),
      productBridge('24-26', ['24','25','26']),
      productBridge('32-41', ['41','31','32']),
      productBridge('44-47', ['47','46','45','44']),
    ],
    clinical: [{ from: '24', to: '26', teeth: ['24','25','26'] }],
    expectBridges: ['13-23', '14-15', '32-41', '44-47', '24-26'],
  },
  {
    label: '31205057-1',
    product: [productBridge('17-18', ['17','18']), productBridge('15-16', ['15','16'])],
    clinical: [{ from: '14', to: '18', teeth: ['14','15','16','17','18'] }],
    expectBridges: ['14-18'],
  },
];

let pass = 0;
for (const c of cases) {
  const result = merge(c.product, c.clinical);
  const got = result.map(x => x.group.raw);
  const expected = c.expectBridges;
  const ok = got.length === expected.length && expected.every(e => got.includes(e));
  console.log(`${ok ? '✓' : '✗'} ${c.label}: expected [${expected.join(', ')}]  got [${got.join(', ')}]`);
  if (ok) pass += 1;
}

if (pass !== cases.length) {
  console.error(`\n${cases.length - pass}/${cases.length} failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
