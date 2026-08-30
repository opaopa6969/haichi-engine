// demo/demo.js を「DOM を模した最小の環境」で実行し、
// 図が実際に描かれる（要素が生成される）ことを確かめる。ブラウザは使わない。
//   node demo/smoke.mjs
import assert from 'node:assert/strict';

// --- 最小の DOM
const listeners = new Map();
function makeEl(tag) {
  const e = {
    tagName: tag, children: [], attrs: {}, textContent: '', innerHTML: '', value: '', checked: false,
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    addEventListener(ev, fn) { (listeners.get(this.id) ?? listeners.set(this.id, []).get(this.id)).push(fn); },
    get firstChild() { return this.children[0] ?? null; },
  };
  return e;
}
const nodes = new Map();
const mk = (id, extra = {}) => { const e = makeEl('div'); e.id = id; Object.assign(e, extra); nodes.set(id, e); return e; };
for (const id of ['bug-before', 'bug-after', 'live', 'lay-pack', 'lay-tree', 'lay-grid', 'relax-no', 'relax-yes', 'city']) mk(id);
for (const id of ['bug-before-v', 'bug-after-v', 'relax-no-v', 'relax-yes-v', 'live-problems', 'city-problems', 'w-out', 'f-out', 'cam-y-out', 'cam-z-out']) mk(id);
mk('w', { value: '460' }); mk('f', { value: '13' }); mk('ellipsis', { checked: false });
mk('cam-y', { value: '700' }); mk('cam-z', { value: '1500' });

globalThis.document = {
  getElementById: (id) => nodes.get(id) ?? null,
  createElementNS: (_ns, tag) => makeEl(tag),
};

await import('./demo.js');

let n = 0; const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`NG ${name}: ${e.message}`); process.exitCode = 1; } };

ok('1. バグの再現が両方描かれる', () => {
  for (const id of ['bug-before', 'bug-after']) assert.ok(nodes.get(id).children.length > 10, `${id} が空`);
  const before = nodes.get('bug-before-v').textContent, after = nodes.get('bug-after-v').textContent;
  assert.match(before, /内側 \d+/); assert.match(after, /内側 \d+/);
  // 壊れていた版は内側に詰め込み、直した版は外に出す — ここが見せどころ
  const inBefore = Number(before.match(/内側 (\d+)/)[1]), inAfter = Number(after.match(/内側 (\d+)/)[1]);
  assert.ok(inBefore > inAfter, `対比になっていない（前 ${inBefore} / 後 ${inAfter}）`);
  assert.match(before, /切り詰め [1-9]/, '壊れていた版で切り詰めが起きていない');
  assert.match(after, /切り詰め 0/, '直した版で切り詰めが残っている');
});

ok('2. 壊してみるが描かれ、指摘が出る', () => {
  assert.ok(nodes.get('live').children.length > 4, 'live が空');
  assert.ok(nodes.get('live-problems').innerHTML.includes('metrics'), '指標が出ていない');
});

ok('3. 3 つの配置が全部描かれる', () => {
  for (const id of ['lay-pack', 'lay-tree', 'lay-grid']) assert.ok(nodes.get(id).children.length > 5, `${id} が空`);
});

ok('4. bounds の有無で領域外の数が変わる', () => {
  const no = nodes.get('relax-no-v').textContent, yes = nodes.get('relax-yes-v').textContent;
  const out = (s) => Number(s.match(/領域外 (\d+)/)[1]);
  assert.ok(out(no) > out(yes), `対比になっていない（なし ${out(no)} / あり ${out(yes)}）`);
  assert.equal(out(yes), 0, 'bounds を渡しても領域外が残っている');
});

ok('5. 3D の街が描かれ、指標が出る', () => {
  assert.ok(nodes.get('city').children.length > 10, 'city が空');
  assert.ok(nodes.get('city-problems').innerHTML.includes('occluded'), '3D の指標が出ていない');
});

console.error(`demo-smoke: ${n} pass`);
