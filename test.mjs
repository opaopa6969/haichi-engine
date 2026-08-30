// haichi-engine の単体テスト。依存ゼロ、node test.mjs で走る。
import assert from 'node:assert/strict';
import { pack, tree, treemap, relax, placeLabels, measure, fitText, textWidth, rng, circleOverlap, rectOverlap } from './index.js';

let n = 0; const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`NG ${name}: ${e.message}`); process.exitCode = 1; } };

ok('rng は決定論的', () => {
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  assert.notEqual(rng(1)(), rng(2)());
});

ok('fitText は「…」込みで幅に収まる', () => {
  for (const s of ['MotorUnitPool', '共通ユーティリティ', 'a', '運動制御モデルの実装']) {
    for (const w of [10, 30, 60, 200]) {
      const cw = 6;
      const out = fitText(s, w, cw);
      assert.ok(textWidth(out, cw) <= w + 1e-6, `"${s}" を ${w}px に切ったら ${textWidth(out, cw)}px になった`);
    }
  }
});

ok('fitText は入るなら切らない', () => assert.equal(fitText('abc', 1000, 6), 'abc'));

ok('pack は重ならない', () => {
  const items = [{ id: 'a', value: 100 }, { id: 'b', value: 50 }, { id: 'c', value: 25 }, { id: 'd', value: 10 }, { id: 'e', value: 5 }];
  const m = pack(items, { size: 500 });
  const cs = [...m.values()];
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++)
    assert.ok(circleOverlap(cs[i], cs[j], 0) < 1, `円 ${i},${j} が ${circleOverlap(cs[i], cs[j], 0).toFixed(2)}px 重なった`);
});

ok('pack は入れ子を親の中に収める', () => {
  const m = pack([{ id: 'p', children: [{ id: 'c1', value: 10 }, { id: 'c2', value: 10 }] }], { size: 400 });
  const p = m.get('p');
  for (const id of ['c1', 'c2']) {
    const c = m.get(id);
    assert.ok(Math.hypot(c.x - p.x, c.y - p.y) + c.r <= p.r + 1e-6, `${id} が親からはみ出した`);
  }
});

ok('pack は決定論的', () => {
  const items = [{ id: 'a', value: 9 }, { id: 'b', value: 4 }, { id: 'c', value: 1 }];
  assert.deepEqual([...pack(items)].map(([k, v]) => [k, v.x.toFixed(6)]), [...pack(items)].map(([k, v]) => [k, v.x.toFixed(6)]));
});

ok('tree は親を子の中央に置く', () => {
  const m = tree([{ id: 'r', children: [{ id: 'a' }, { id: 'b' }] }]);
  assert.equal(m.get('r').x, (m.get('a').x + m.get('b').x) / 2);
  assert.ok(m.get('a').y > m.get('r').y, '子が親より下にない');
});

ok('treemap は面積が値に比例する', () => {
  const m = treemap([{ id: 'a', value: 3 }, { id: 'b', value: 1 }], { w: 400, h: 400, padding: 0 });
  const area = (id) => { const c = m.get(id); return c.w * c.h; };
  const ratio = area('a') / area('b');
  assert.ok(ratio > 2.5 && ratio < 3.5, `面積比が ${ratio.toFixed(2)}（期待 3 前後）`);
});

ok('treemap は領域からはみ出さない', () => {
  const m = treemap([{ id: 'a', value: 5 }, { id: 'b', value: 3 }, { id: 'c', value: 2 }], { w: 300, h: 200, padding: 2 });
  for (const [id, c] of m) {
    assert.ok(c.x - c.w / 2 >= -1 && c.x + c.w / 2 <= 301, `${id} が横にはみ出した`);
    assert.ok(c.y - c.h / 2 >= -1 && c.y + c.h / 2 <= 201, `${id} が縦にはみ出した`);
  }
});

ok('relax は重なりを解消する', () => {
  const items = [{ id: 'a', x: 0, y: 0, r: 20 }, { id: 'b', x: 5, y: 0, r: 20 }, { id: 'c', x: 0, y: 5, r: 20 }];
  const m = relax(items, { gap: 2, iterations: 400 });
  const cs = [...m.values()];
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++)
    assert.ok(circleOverlap(cs[i], cs[j], 0) < 1, `解消後も ${circleOverlap(cs[i], cs[j], 0).toFixed(2)}px 重なっている`);
});

ok('relax は pinned を動かさない', () => {
  const m = relax([{ id: 'a', x: 0, y: 0, r: 20 }, { id: 'b', x: 5, y: 0, r: 20 }], { pinned: new Set(['a']), iterations: 200 });
  assert.equal(m.get('a').x, 0); assert.equal(m.get('a').y, 0);
});

ok('placeLabels は小さすぎる字を出さない', () => {
  const m = placeLabels([{ id: 'a', x: 0, y: 0, r: 10, label: 'hello', font: 5 }], { minFont: 9 });
  assert.equal(m.get('a').hidden, true);
});

ok('placeLabels は重ねない', () => {
  const shapes = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, x: i * 30, y: 0, r: 12, label: `label${i}`, font: 12 }));
  const m = placeLabels(shapes, { minFont: 9 });
  const boxes = [...m.values()].filter((v) => !v.hidden);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
    assert.ok(rectOverlap(boxes[i], boxes[j], 0) <= 0.5, 'ラベルが重なった');
});

ok('measure は重なりを見つける', () => {
  const r = measure([{ id: 'a', x: 0, y: 0, r: 20 }, { id: 'b', x: 10, y: 0, r: 20 }]);
  assert.equal(r.metrics.overlaps, 1);
  assert.equal(r.problems[0].code, 'H101');
  assert.match(r.problems[0].message, /px 重なっている/);
});

ok('measure のメッセージは実測値と直し方を含む', () => {
  const r = measure([{ id: 'a', x: 0, y: 0, r: 8, label: 'とても長い名前です', font: 12 }]);
  const p = r.problems.find((x) => x.code === 'H102');
  assert.ok(p, 'はみ出しを検出できていない');
  assert.match(p.message, /px|入らない/); assert.match(p.message, /—/);
});

ok('measure は交差を数える', () => {
  const shapes = [{ id: 'a', x: 0, y: 0, r: 5 }, { id: 'b', x: 100, y: 100, r: 5 }, { id: 'c', x: 0, y: 100, r: 5 }, { id: 'd', x: 100, y: 0, r: 5 }];
  const r = measure(shapes, [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }]);
  assert.equal(r.metrics.crossings, 1);
});

ok('measure は綺麗な配置に文句を言わない', () => {
  const shapes = [{ id: 'a', x: 0, y: 0, r: 40, label: 'ab', font: 12 }, { id: 'b', x: 120, y: 0, r: 40, label: 'cd', font: 12 }];
  const r = measure(shapes, [{ from: 'a', to: 'b' }]);
  assert.equal(r.problems.length, 0, JSON.stringify(r.problems));
});

console.error(`test: ${n} pass`);
