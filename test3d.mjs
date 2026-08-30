// haichi-engine / 3D のテスト。node test3d.mjs で走る。
import assert from 'node:assert/strict';
import { blocks, relax3, project, visibleFrom, measure3, lodFor, semanticLod, spatialHash, dist3, overlapOf3 } from './index3d.js';

let n = 0; const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`NG ${name}: ${e.message}`); process.exitCode = 1; } };

const CAM = { x: 0, y: 300, z: 600, target: { x: 500, y: 0, z: 500 }, fov: 50, width: 1600, height: 900 };

ok('blocks は区画に建物を建てる', () => {
  const m = blocks([
    { id: 'a', value: 300, height: 40 },
    { id: 'b', value: 100, height: 10 },
  ], { w: 400, d: 400, padding: 4 });
  assert.equal(m.size, 2);
  assert.ok(m.get('a').w * m.get('a').d > m.get('b').w * m.get('b').d, '床面積が値に比例していない');
  assert.equal(m.get('a').h, 40);
  assert.equal(m.get('a').y, 0, '地面に建っていない');
});

ok('blocks は区画（子を持つもの）に高さを与えない', () => {
  const m = blocks([{ id: 'p', value: 400, children: [{ id: 'c', value: 100, height: 20 }] }], { w: 400, d: 400 });
  assert.equal(m.get('p').h, 0, '区画に高さが付いている');
  assert.equal(m.get('c').h, 20);
  assert.equal(m.get('c').parent, 'p');
});

ok('relax3 は 3D の重なりを解消する', () => {
  const items = [
    { id: 'a', x: 0, y: 0, z: 0, w: 40, d: 40, h: 20 },
    { id: 'b', x: 10, y: 0, z: 5, w: 40, d: 40, h: 20 },
  ];
  const m = relax3(items, { gap: 2, iterations: 300 });
  const p = m.get('a'), q = m.get('b');
  const ox = (p.w + q.w) / 2 - Math.abs(p.x - q.x);
  const oz = (p.d + q.d) / 2 - Math.abs(p.z - q.z);
  assert.ok(Math.min(ox, oz) <= 0.5, `まだ ${Math.min(ox, oz).toFixed(2)} 重なっている`);
});

ok('relax3 は既定で y を動かさない（地面に建つ）', () => {
  const m = relax3([{ id: 'a', x: 0, y: 0, z: 0, w: 40, d: 40, h: 20 }, { id: 'b', x: 5, y: 0, z: 0, w: 40, d: 40, h: 20 }], { iterations: 50 });
  for (const v of m.values()) assert.equal(v.y, 0);
});

ok('project は前方の点を画面内に落とす', () => {
  const p = project({ x: 500, y: 0, z: 500 }, CAM);
  assert.equal(p.behind, false);
  assert.ok(Math.abs(p.x - 800) < 1, `注視点が画面中央に来ない（x=${p.x.toFixed(1)}）`);
  assert.ok(Math.abs(p.y - 450) < 1, `注視点が画面中央に来ない（y=${p.y.toFixed(1)}）`);
});

ok('project は背後の点を behind にする', () => {
  const p = project({ x: -1000, y: 0, z: 1200 }, CAM);
  assert.equal(p.behind, true);
});

ok('project の scale は距離に反比例する', () => {
  const near = project({ x: 500, y: 0, z: 480 }, CAM);
  const far = project({ x: 500, y: 0, z: 100 }, CAM);
  assert.ok(near.scale > far.scale, '近い方が小さく見えている');
});

ok('visibleFrom は背後と画面外を落とす', () => {
  const objs = [
    { id: 'front', x: 500, y: 0, z: 500, r: 20 },
    { id: 'behind', x: -900, y: 0, z: 1400, r: 20 },
  ];
  const { visible } = visibleFrom(objs, CAM);
  assert.deepEqual(visible.map((v) => v.id), ['front']);
});

ok('visibleFrom は完全に隠れたものを occluded にする', () => {
  const cam = { x: 0, y: 0, z: 0, target: { x: 0, y: 0, z: 100 }, fov: 50, width: 800, height: 600 };
  const objs = [
    { id: 'wall', x: 0, y: 0, z: 50, r: 40 },
    { id: 'hidden', x: 0, y: 0, z: 200, r: 5 },
  ];
  const { visible, occluded } = visibleFrom(objs, cam);
  assert.deepEqual(visible.map((v) => v.id), ['wall']);
  assert.deepEqual(occluded.map((v) => v.id), ['hidden']);
});

ok('measure3 は重なりを見つける', () => {
  const objs = [
    { id: 'a', x: 0, y: 0, z: 0, w: 40, d: 40, h: 10 },
    { id: 'b', x: 10, y: 0, z: 0, w: 40, d: 40, h: 10 },
  ];
  const r = measure3(objs, [], null);
  assert.equal(r.metrics.overlaps, 1);
  assert.equal(r.problems[0].code, 'V101');
});

ok('measure3 は通れない隙間を報告する（V102）', () => {
  const objs = [
    { id: 'a', x: 0, y: 0, z: 0, w: 40, d: 200, h: 30 },
    { id: 'b', x: 41, y: 0, z: 0, w: 40, d: 200, h: 30 },
  ];
  const r = measure3(objs, [], null, { walkWidth: 8, gap: 0 });
  assert.ok(r.metrics.narrowGaps >= 1, `隙間 1 しかないのに通れる判定（${JSON.stringify(r.metrics)}）`);
  assert.ok(r.problems.some((p) => p.code === 'V102'));
});

ok('measure3 は十分な通路を責めない', () => {
  const objs = [
    { id: 'a', x: 0, y: 0, z: 0, w: 40, d: 200, h: 30 },
    { id: 'b', x: 80, y: 0, z: 0, w: 40, d: 200, h: 30 },
  ];
  const r = measure3(objs, [], null, { walkWidth: 8, gap: 0 });
  assert.equal(r.metrics.narrowGaps, 0);
});

ok('measure3 は遮蔽が多いと報告する（V103）', () => {
  const cam = { x: 0, y: 0, z: 0, target: { x: 0, y: 0, z: 100 }, fov: 50, width: 800, height: 600 };
  const objs = [{ id: 'wall', x: 0, y: 0, z: 50, r: 60 }];
  for (let i = 0; i < 5; i++) objs.push({ id: `h${i}`, x: i * 2 - 4, y: 0, z: 300, r: 3 });
  const r = measure3(objs, [], cam);
  assert.ok(r.metrics.occluded >= 5, `隠れているのは ${r.metrics.occluded}`);
  assert.ok(r.problems.some((p) => p.code === 'V103'));
});

ok('measure3 は遠いラベルを読めないと言う（V104）', () => {
  const cam = { x: 0, y: 0, z: 0, target: { x: 0, y: 0, z: 100 }, fov: 50, width: 800, height: 600 };
  const objs = [{ id: 'far', x: 0, y: 0, z: 5000, r: 10, label: 'とおい建物', labelHeight: 2 }];
  const r = measure3(objs, [], cam, { minFont: 9 });
  assert.ok(r.problems.some((p) => p.code === 'V104'), JSON.stringify(r.metrics));
});

ok('measure3 は高さの落差が極端だと報告する（V107）', () => {
  const objs = [{ id: 'tower', x: 0, y: 0, z: 0, w: 10, d: 10, h: 5000 }];
  for (let i = 0; i < 9; i++) objs.push({ id: `low${i}`, x: 100 + i * 40, y: 0, z: 0, w: 10, d: 10, h: 10 });
  const r = measure3(objs, [], null);
  assert.ok(r.problems.some((p) => p.code === 'V107'), `heightRatio=${r.metrics.heightRatio}`);
});

ok('measure3 は綺麗な街に文句を言わない', () => {
  const objs = [
    { id: 'a', x: 0, y: 0, z: 0, w: 40, d: 40, h: 20 },
    { id: 'b', x: 100, y: 0, z: 0, w: 40, d: 40, h: 25 },
    { id: 'c', x: 0, y: 0, z: 100, w: 40, d: 40, h: 18 },
  ];
  const r = measure3(objs, [], null, { walkWidth: 8 });
  assert.equal(r.problems.length, 0, JSON.stringify(r.problems));
});

ok('lodFor は近いほど段が小さい', () => {
  assert.equal(lodFor(10), 0);
  assert.equal(lodFor(60), 1);
  assert.equal(lodFor(1000), 3);
});

ok('semanticLod は画面占有で開閉を決める', () => {
  const cam = { x: 0, y: 0, z: 0, target: { x: 0, y: 0, z: 100 }, fov: 50, width: 800, height: 600 };
  const objs = [{ id: 'near', x: 0, y: 0, z: 50, r: 30 }, { id: 'far', x: 0, y: 0, z: 8000, r: 2 }];
  const { open, collapsed } = semanticLod(objs, cam, { minPx: 24 });
  assert.ok(open.has('near'), '近いのに開かない');
  assert.ok(collapsed.includes('far'), '遠いのに開いている');
});

ok('semanticLod のヒステリシスは点滅を防ぐ', () => {
  const cam = { x: 0, y: 0, z: 0, target: { x: 0, y: 0, z: 100 }, fov: 50, width: 800, height: 600 };
  // 閾値ちょうど付近に置く
  const objs = [{ id: 'edge', x: 0, y: 0, z: 900, r: 12 }];
  const closed = semanticLod(objs, cam, { minPx: 24, open: new Set() });
  const opened = semanticLod(objs, cam, { minPx: 24, open: new Set(['edge']) });
  assert.ok(!closed.open.has('edge') || opened.open.has('edge'), '開いている方が閉じやすくなっている');
});

ok('spatialHash は近傍だけを返す', () => {
  const objs = Array.from({ length: 200 }, (_, i) => ({ id: `o${i}`, x: (i % 20) * 50, y: 0, z: Math.floor(i / 20) * 50 }));
  const h = spatialHash(objs, { cell: 64 });
  const near = h.near(0, 0, 64);
  assert.ok(near.length < objs.length, '全部返している');
  assert.ok(near.some((o) => o.id === 'o0'), '自分自身が入っていない');
  for (const o of near) assert.ok(dist3({ x: 0, y: 0, z: 0 }, o) < 300, `遠いものが混ざった: ${o.id}`);
});


ok('3D も球と直方体の混在を正しく測る', () => {
  const sph = { id: 's', x: 0, y: 0, z: 0, r: 10 };
  const box = { id: 'b', x: 0, y: 0, z: 0, w: 20, d: 20, h: 20 };
  assert.ok(overlapOf3(sph, box, 0) > 5, `重なりを ${overlapOf3(sph, box, 0).toFixed(1)} と答えた`);
  const r = measure3([sph, box], [], null);
  assert.equal(r.metrics.overlaps, 1, '混在すると重なりを見落とす');
});

ok('3D で離れていれば重ならない', () => {
  assert.ok(overlapOf3({ id: 's', x: 0, y: 0, z: 0, r: 10 }, { id: 'b', x: 200, y: 0, z: 0, w: 20, d: 20, h: 20 }, 0) < 0);
});

console.error(`test3d: ${n} pass`);
