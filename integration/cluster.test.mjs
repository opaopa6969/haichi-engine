// 集約のテスト。
import assert from 'node:assert/strict';
import { splitBySize, groupBy, cluster, summarize, leafCount } from '../cluster.js';
import { navigable, bandwidth } from '../cognitive.js';

let n = 0; const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`NG ${name}: ${e.message}`); process.exitCode = 1; } };

const leaf = (id, extra = {}) => ({ id, ...extra });
const branch = (id, kids, extra = {}) => ({ id, children: kids, ...extra });

ok('leafCount は葉を数える', () => {
  assert.equal(leafCount(leaf('a')), 1);
  assert.equal(leafCount(branch('p', [leaf('a'), leaf('b')])), 2);
  assert.equal(leafCount(branch('p', [branch('q', [leaf('a'), leaf('b')]), leaf('c')])), 3);
});

ok('大きすぎる塊を割って入口を増やす', () => {
  // 入口 2 個・片方に 200 葉。実データ（入口 4 / 最大 2044）と同じ形
  const big = branch('big', Array.from({ length: 5 }, (_, i) => branch(`s${i}`, Array.from({ length: 40 }, (_, j) => leaf(`b${i}_${j}`)))));
  const out = splitBySize([big, branch('small', [leaf('x')])], { maxEntry: 30, maxBlock: 120 });
  assert.ok(out.length > 2, `割れていない（${out.length}）`);
  assert.ok(Math.max(...out.map(leafCount)) <= 120, `まだ ${Math.max(...out.map(leafCount))} 葉の塊がある`);
});

ok('入口の上限を超えて割らない', () => {
  const big = branch('big', Array.from({ length: 50 }, (_, i) => branch(`s${i}`, [leaf(`a${i}`), leaf(`b${i}`)])));
  const out = splitBySize([big], { maxEntry: 10, maxBlock: 5 });
  assert.ok(out.length <= 10, `入口が ${out.length} 個になった`);
});

ok('割れない塊で止まらず、次に大きいものを試す', () => {
  const flat = branch('flat', Array.from({ length: 300 }, (_, i) => leaf(`f${i}`)));  // 枝が無い＝割れない
  const splittable = branch('ok', Array.from({ length: 4 }, (_, i) => branch(`s${i}`, Array.from({ length: 50 }, (_, j) => leaf(`o${i}_${j}`)))));
  const out = splitBySize([flat, splittable], { maxEntry: 30, maxBlock: 120 });
  assert.ok(out.length > 2, '割れる方も諦めてしまった');
  assert.ok(out.some((c) => c.id === 'flat'), '割れない塊が消えた');
});

ok('直下の葉を行き場を失わせない', () => {
  const t = branch('t', [branch('s1', [leaf('a'), leaf('b')]), branch('s2', [leaf('c')]), leaf('直下')]);
  const out = splitBySize([t], { maxEntry: 30, maxBlock: 2 });
  const all = out.flatMap(function collect(x) { return x.children ? x.children.flatMap(collect) : [x.id]; });
  assert.ok(all.includes('直下'), '直下の葉が消えた');
});

ok('groupBy は戦略を順に試し、偏ったら次へ', () => {
  // 1 つ目の戦略は全部同じキー（＝偏る）、2 つ目で割れる
  const items = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, dir: 'same', role: i % 4 }));
  const g = groupBy(items, { strategies: [(x) => x.dir, (x) => x.role] });
  assert.equal(g.length, 4, `${g.length} 束（役割で 4 束のはず）`);
});

ok('groupBy は全部同じなら空を返す', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, k: 'same' }));
  assert.deepEqual(groupBy(items, { strategies: [(x) => x.k] }), []);
});

ok('groupBy は束が多すぎるとき「その他」に寄せる', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, k: `k${i}` }));  // 全部バラバラ
  const g = groupBy(items, { strategies: [(x) => x.k], room: 5 });
  assert.ok(g.length <= 5, `${g.length} 束`);
  assert.equal(g[g.length - 1].key, 'その他');
  assert.equal(g.reduce((a, x) => a + x.items.length, 0), 100, '要素が失われた');
});

ok('groupBy は決定論的', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, k: `g${i % 5}` }));
  const run = () => groupBy(items, { strategies: [(x) => x.k] }).map((g) => `${g.key}:${g.items.length}`).join('|');
  assert.equal(run(), run());
});

ok('cluster は依存の強い塊に切る', () => {
  // 3 つの塊が弱く繋がったグラフ
  const ids = [], edges = [];
  for (let g = 0; g < 3; g++) for (let i = 0; i < 10; i++) ids.push(`g${g}_${i}`);
  for (let g = 0; g < 3; g++) for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++)
    edges.push({ from: `g${g}_${i}`, to: `g${g}_${j}`, weight: 5 });
  for (let g = 1; g < 3; g++) edges.push({ from: `g${g - 1}_0`, to: `g${g}_0`, weight: 1 });
  const cs = cluster(ids, edges, { k: 3 });
  assert.equal(cs.length, 3, `${cs.length} 群`);
  // 各群が 1 つの元の塊に対応していること
  for (const c of cs) {
    const gs = new Set(c.ids.map((id) => id.split('_')[0]));
    assert.equal(gs.size, 1, `群が混ざった: ${[...gs].join(',')}`);
  }
});

ok('cluster は maxSize で自動的に数を決める', () => {
  const ids = Array.from({ length: 100 }, (_, i) => `n${i}`);
  const edges = ids.slice(1).map((id, i) => ({ from: ids[i], to: id, weight: 1 }));
  const cs = cluster(ids, edges, { maxSize: 30 });
  assert.ok(cs.length >= 4, `${cs.length} 群（100/30 で 4 群以上のはず）`);
  assert.equal(cs.reduce((a, c) => a + c.ids.length, 0), 100, '要素が失われた');
});

ok('cluster は決定論的、かつ小さすぎる入力で壊れない', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const edges = [{ from: 'a', to: 'b', weight: 3 }, { from: 'c', to: 'd', weight: 3 }];
  assert.deepEqual(cluster(ids, edges, { k: 2 }), cluster(ids, edges, { k: 2 }));
  assert.deepEqual(cluster([], []), []);
  assert.equal(cluster(['a'], []).length, 1);
});

ok('summarize は群の代表を出す', () => {
  const items = [{ n: 3, r: 'io' }, { n: 5, r: 'io' }, { n: 1, r: 'test' }];
  const s = summarize(items, { size: (x) => x.n, tag: (x) => x.r });
  assert.equal(s.count, 3); assert.equal(s.total, 9);
  assert.equal(s.dominant, 'io');
  assert.deepEqual(s.tags, { io: 2, test: 1 });
});

ok('splitBySize が navigable の指摘を実際に減らす', () => {
  // 建物 900 / 入口 3 / 最大 600 という実データに近い形
  const t = [
    branch('a', Array.from({ length: 6 }, (_, i) => branch(`a${i}`, Array.from({ length: 100 }, (_, j) => leaf(`a${i}_${j}`))))),
    branch('b', Array.from({ length: 200 }, (_, i) => leaf(`b${i}`))),
    branch('c', [leaf('c0')]),
  ];
  const total = t.reduce((s, x) => s + leafCount(x), 0);
  const before = navigable({ total, entryPoints: t.length, groups: t.length, groupSize: Math.max(...t.map(leafCount)), search: true });
  const after0 = splitBySize(t, { maxEntry: 30, maxBlock: 120 });
  const after = navigable({ total, entryPoints: after0.length, groups: after0.length, groupSize: Math.max(...after0.map(leafCount)), search: true });
  assert.ok(before.problems.some((p) => p.code === 'C202'), '前提が崩れている');
  assert.ok(!after.problems.some((p) => p.code === 'C202'), `まだ詰まっている（最大 ${Math.max(...after0.map(leafCount))}）`);
  assert.ok(!after.problems.some((p) => p.code === 'C201'), `入口が増えすぎた（${after0.length}）`);
});

console.error(`cluster: ${n} pass`);
