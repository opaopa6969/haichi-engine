// zumen アダプタのテスト。ZIR の最小例を組んで、配置と測定が通ることを確かめる。
import assert from 'node:assert/strict';
import { zirToItems, layoutZir } from './zumen-layout.mjs';

const doc = {
  id: 'repo:demo',
  nodes: [
    { id: 'repo:demo', kind: 'repository', name: 'demo', parent: null },
    { id: 'comp:demo/core', kind: 'component', name: 'Core', parent: 'repo:demo', metrics: { loc: 400 } },
    { id: 'comp:demo/io', kind: 'component', name: 'IO', parent: 'repo:demo', metrics: { loc: 120 } },
    { id: 'unit:demo/a.js/Engine', kind: 'unit', name: 'Engine', parent: 'mod:demo/a.js', component: 'comp:demo/core', metrics: { loc: 300 } },
    { id: 'unit:demo/a.js/util', kind: 'unit', name: 'util', parent: 'mod:demo/a.js', component: 'comp:demo/core', metrics: { loc: 40 } },
    { id: 'unit:demo/b.js/read', kind: 'unit', name: 'read', parent: 'mod:demo/b.js', component: 'comp:demo/io', metrics: { loc: 60 } },
  ],
  edges: [{ kind: 'calls', from: 'unit:demo/a.js/Engine', to: 'unit:demo/b.js/read', weight: 3 }],
};

let n = 0; const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`NG ${name}: ${e.message}`); process.exitCode = 1; } };

ok('ZIR を入れ子に畳む', () => {
  const items = zirToItems(doc.nodes, { rootId: 'repo:demo' });
  assert.equal(items.length, 2);
  const core = items.find((x) => x.id === 'comp:demo/core');
  assert.equal(core.children.length, 2, 'unit が component の下に来ていない');
});

ok('配置すると全ノードに座標が付く', () => {
  const { placed } = layoutZir(doc);
  for (const id of ['comp:demo/core', 'comp:demo/io', 'unit:demo/a.js/Engine']) assert.ok(placed.has(id), `${id} に座標が無い`);
});

ok('unit は所属 component の中に収まる', () => {
  const { placed } = layoutZir(doc);
  const p = placed.get('comp:demo/core');
  for (const id of ['unit:demo/a.js/Engine', 'unit:demo/a.js/util']) {
    const c = placed.get(id);
    assert.ok(Math.hypot(c.x - p.x, c.y - p.y) + c.r <= p.r + 1e-6, `${id} が Core からはみ出した`);
  }
});

ok('component をまたぐ辺だけが残る', () => {
  const { edges } = layoutZir(doc);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].from, 'comp:demo/core');
  assert.equal(edges[0].to, 'comp:demo/io');
});

ok('測定が返る', () => {
  const { report } = layoutZir(doc);
  assert.ok(report.metrics.shapes > 0);
  assert.equal(report.metrics.overlaps, 0, JSON.stringify(report.problems.slice(0, 2)));
});

console.error(`zumen-layout: ${n} pass`);
