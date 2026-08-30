// haichi-engine の単体テスト。依存ゼロ、node test.mjs で走る。
import assert from 'node:assert/strict';
import { pack, tree, treemap, relax, grid, placeLabels, measure, fitText, textWidth, rng, circleOverlap, rectOverlap, overlapOf } from './index.js';

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


ok('浅い交差を角度で検出する（H107）', () => {
  // ほぼ平行に近い 2 本を交差させる
  const shapes = [{ id: 'a', x: 0, y: 0, r: 3 }, { id: 'b', x: 300, y: 10, r: 3 }, { id: 'c', x: 0, y: 10, r: 3 }, { id: 'd', x: 300, y: 0, r: 3 }];
  const r = measure(shapes, [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }]);
  assert.ok(r.metrics.minCrossAngle < 20, `交差角 ${r.metrics.minCrossAngle}`);
  assert.ok(r.problems.some((p) => p.code === 'H107'), '浅い交差を報告していない');
});

ok('直角の交差は責めない（H107）', () => {
  const shapes = [{ id: 'a', x: 0, y: 50, r: 3 }, { id: 'b', x: 100, y: 50, r: 3 }, { id: 'c', x: 50, y: 0, r: 3 }, { id: 'd', x: 50, y: 100, r: 3 }];
  const r = measure(shapes, [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }]);
  assert.equal(r.metrics.crossings, 1);
  assert.ok(!r.problems.some((p) => p.code === 'H107'), '直角なのに浅いと言った');
});

ok('辺がラベルを横切ると報告する（H108）', () => {
  const shapes = [
    { id: 'a', x: 0, y: 0, r: 6 }, { id: 'b', x: 400, y: 0, r: 6 },
    { id: 'm', x: 200, y: 0, r: 40, label: 'まんなか', font: 14 },
  ];
  const r = measure(shapes, [{ from: 'a', to: 'b' }]);
  assert.ok(r.metrics.labelHits >= 1, 'ラベルの上を通っているのに 0');
});

ok('辺を間引きすぎると報告する（H109）', () => {
  const shapes = [{ id: 'a', x: 0, y: 0, r: 20 }, { id: 'b', x: 200, y: 0, r: 20 }];
  const shown = [{ from: 'a', to: 'b', weight: 10 }];
  const ok1 = measure(shapes, shown, { totalEdgeWeight: 12 });
  assert.ok(!ok1.problems.some((p) => p.code === 'H109'), '83% 見えているのに責めた');
  const ng = measure(shapes, shown, { totalEdgeWeight: 100 });
  assert.ok(ng.problems.some((p) => p.code === 'H109'), '10% しか見えていないのに黙った');
  assert.ok(Math.abs(ng.metrics.visibleEdgeWeightRatio - 0.1) < 1e-9);
});

ok('totalEdgeWeight を渡さなければ H109 は出ない', () => {
  const r = measure([{ id: 'a', x: 0, y: 0, r: 20 }, { id: 'b', x: 200, y: 0, r: 20 }], [{ from: 'a', to: 'b' }]);
  assert.ok(!r.problems.some((p) => p.code === 'H109'));
});


// --- tetsugo の実地検証で出た欠陥を固定する（再発防止）

ok('小さい図形のラベルは外に出す（内に「…」を詰めない）', () => {
  // 半径 12 の円に長い名前。切り詰めれば「…」しか入らない
  const m = placeLabels([{ id: 'a', x: 0, y: 0, r: 12, label: '宗谷岬', font: 13 }], { minFont: 9 });
  const p = m.get('a');
  assert.ok(!p.hidden, '置けなかった');
  assert.equal(p.at, 'outside', `内側に詰め込んだ（at=${p.at}, text="${p.text}"）`);
  assert.equal(p.text, '宗谷岬', '文字が切り詰められた');
});

ok('入るものは内に置く', () => {
  const m = placeLabels([{ id: 'a', x: 0, y: 0, r: 60, label: 'ab', font: 12 }], { minFont: 9 });
  assert.equal(m.get('a').at, 'inside');
});

ok('多数の小さい図形でも外周に散らして重ねない', () => {
  const shapes = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, x: (i % 6) * 90, y: Math.floor(i / 6) * 90, r: 10, label: `駅名${i}`, font: 12 }));
  const m = placeLabels(shapes, { minFont: 9 });
  const boxes = [...m.values()].filter((v) => !v.hidden);
  assert.ok(boxes.length >= 25, `${boxes.length}/30 しか置けていない`);
  assert.ok(boxes.every((b) => b.text && b.text !== '…'), '「…」だけのラベルが出た');
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
    assert.ok(rectOverlap(boxes[i], boxes[j], 0) <= 0.5, 'ラベルが重なった');
});

ok('「…」だけのラベルは measure が不合格にする（H102）', () => {
  const r = measure([{ id: 'a', x: 0, y: 0, r: 10, label: '宗谷岬', font: 13 }]);
  assert.ok(r.problems.some((p) => p.code === 'H102'), '情報ゼロのラベルを合格にした');
});

ok('prefer:outside は内に入るものも外に出す', () => {
  const m = placeLabels([{ id: 'a', x: 0, y: 0, r: 60, label: 'ab', font: 12 }], { prefer: 'outside' });
  assert.equal(m.get('a').at, 'outside');
});

ok('priority が高いものから先に置き場所を取る', () => {
  const shapes = [
    { id: 'low', x: 0, y: 0, r: 40, label: 'ひくい', font: 12, priority: 0 },
    { id: 'high', x: 0, y: 0, r: 5, label: 'たかい', font: 12, priority: 10 },
  ];
  const m = placeLabels(shapes, { minFont: 9 });
  assert.ok(!m.get('high').hidden, '優先度が高い方が置けていない');
});

ok('外に置いたラベルを measure が見る（labelBox）', () => {
  // 図形どうしは離れているが、外に出したラベルは重なっている
  const shapes = [
    { id: 'a', x: 0, y: 0, r: 5, label: '積丹岬', font: 12, labelBox: { x: 0, y: -20, w: 60, h: 14 } },
    { id: 'b', x: 40, y: 0, r: 5, label: '神威岬', font: 12, labelBox: { x: 30, y: -20, w: 60, h: 14 } },
  ];
  const r = measure(shapes, [], { gap: 0 });
  assert.ok(r.problems.some((p) => p.code === 'H101' && p.message.includes('ラベルが')), 'ラベル同士の重なりを見ていない');
});

ok('labelBox を渡したら H102（はみ出し）は出さない', () => {
  const r = measure([{ id: 'a', x: 0, y: 0, r: 5, label: 'とても長い駅名', font: 12, labelBox: { x: 0, y: -20, w: 120, h: 14 } }]);
  assert.ok(!r.problems.some((p) => p.code === 'H102'), '外置きなのに、はみ出すと言った');
});

ok('relax は axis で動く向きを縛れる', () => {
  const m = relax([{ id: 'a', x: 0, y: 0, r: 20 }, { id: 'b', x: 5, y: 5, r: 20 }], { axis: 'x', iterations: 200 });
  for (const v of m.values()) assert.ok(Math.abs(v.y - (v.id === 'a' ? 0 : 5)) < 1e-9, 'y が動いた');
});

ok('relax は maxMove で元位置からの距離を縛れる', () => {
  const m = relax([{ id: 'a', x: 0, y: 0, r: 40 }, { id: 'b', x: 5, y: 0, r: 40 }], { maxMove: 3, iterations: 400 });
  assert.ok(Math.hypot(m.get('a').x - 0, m.get('a').y - 0) <= 3.001, '3px 以上動いた');
});

ok('relax は grid で格子に載せ直す', () => {
  const m = relax([{ id: 'a', x: 0, y: 0, r: 20 }, { id: 'b', x: 7, y: 3, r: 20 }], { grid: 40, iterations: 200 });
  for (const v of m.values()) { assert.equal(Math.abs(v.x % 40), 0); assert.equal(Math.abs(v.y % 40), 0); }
});


// --- netmahg の実地検証で出た欠陥を固定する

ok('完全に同じ位置のものを分離する', () => {
  const m = relax([{ id: 'a', x: 0, y: 0, w: 40, h: 20 }, { id: 'b', x: 0, y: 0, w: 40, h: 20 }], { iterations: 200, gap: 0 });
  const a = m.get('a'), b = m.get('b');
  assert.ok(rectOverlap(a, b, 0) <= 0.5, `重なったまま（a=${a.x},${a.y} b=${b.x},${b.y}）`);
});

ok('同位置の分離は決定論的', () => {
  const run = () => [...relax([{ id: 'a', x: 5, y: 5, r: 10 }, { id: 'b', x: 5, y: 5, r: 10 }], { iterations: 100 })].map(([k, v]) => `${k}:${v.x.toFixed(6)},${v.y.toFixed(6)}`).join('|');
  assert.equal(run(), run());
});

ok('bounds の外へ押し出さない', () => {
  const b = { x: 0, y: 0, w: 100, h: 100 };
  const items = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, x: 0, y: 0, r: 20 }));
  const m = relax(items, { bounds: b, iterations: 300, gap: 2 });
  for (const v of m.values()) {
    assert.ok(Math.abs(v.x) + v.r <= b.w / 2 + 0.01, `${v.id} が横にはみ出した（x=${v.x.toFixed(1)}）`);
    assert.ok(Math.abs(v.y) + v.r <= b.h / 2 + 0.01, `${v.id} が縦にはみ出した（y=${v.y.toFixed(1)}）`);
  }
});

ok('入りきらなければ measure が H110 で報告する', () => {
  const b = { x: 0, y: 0, w: 100, h: 100 };
  const shapes = [{ id: 'big', x: 0, y: 0, w: 300, h: 20 }];
  const r = measure(shapes, [], { bounds: b });
  assert.ok(r.problems.some((p) => p.code === 'H110'), '領域外を見ていない');
  assert.equal(r.metrics.outside, 1);
});

ok('scrollable なら極端な縦横比を責めない（H106）', () => {
  const hand = Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, x: i * 40, y: 0, w: 36, h: 52 }));
  assert.ok(measure(hand, []).problems.some((p) => p.code === 'H106'), '前提が崩れている');
  assert.ok(!measure(hand, [], { scrollable: true }).problems.some((p) => p.code === 'H106'), 'スクロール前提でも責めた');
});

ok('grid は順序を保って並べる', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, w: 30, h: 40 }));
  const { items: m } = grid(items, { x: 0, y: 0, gap: 4 });
  const xs = items.map((it) => m.get(it.id).x);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], '順序が崩れた');
});

ok('grid は cols で折り返す', () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, w: 30, h: 40 }));
  const { rows } = grid(items, { cols: 3, gap: 4 });
  assert.equal(rows, 3, `行数が ${rows}`);
});

ok('grid は入りきらない量を overflow で返す（勝手に縮めない）', () => {
  const items = Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, w: 36, h: 52 }));
  const { overflow, width } = grid(items, { gap: 4, bounds: { w: 355, h: 200 }, cols: 0 });
  assert.ok(width <= 355 + 40, `折り返していない（width=${width}）`);
  const flat = grid(items, { gap: 4, cols: 99 });
  assert.ok(flat.width > 355, '一列なら 355 を超えるはず');
});

ok('grid は gapAfter で牌の間隔を空けられる（ツモ牌）', () => {
  const items = [{ id: 'a', w: 30, h: 40, gapAfter: 20 }, { id: 'b', w: 30, h: 40 }];
  const { items: m } = grid(items, { gap: 4 });
  assert.ok(m.get('b').x - m.get('a').x > 30 + 4 + 10, '間隔が空いていない');
});


// --- 形が混在するときの重なり判定（codex が tetsugo 評価のついでに見つけた）

ok('円と矩形の混在を正しく測る', () => {
  // 同心の r=10 円と 20x20 矩形。矩形判定に落ちると「重なり 0」と答えてしまう
  const c = { id: 'c', x: 0, y: 0, r: 10 }, q = { id: 'q', x: 0, y: 0, w: 20, h: 20 };
  assert.ok(overlapOf(c, q, 0) > 5, `重なりを ${overlapOf(c, q, 0).toFixed(1)} と答えた`);
  const r = measure([c, q], []);
  assert.equal(r.metrics.overlaps, 1, '混在すると重なりを見落とす');
});

ok('円と矩形が離れていれば重ならない', () => {
  assert.ok(overlapOf({ id: 'c', x: 0, y: 0, r: 10 }, { id: 'q', x: 100, y: 0, w: 20, h: 20 }, 0) < 0);
});

ok('矩形の角に近い円を正しく扱う', () => {
  // 角から斜めに離れた円。辺までの距離ではなく角までの距離で測らないと誤る
  const c = { id: 'c', x: 17, y: 17, r: 5 }, q = { id: 'q', x: 0, y: 0, w: 20, h: 20 };
  const d = Math.hypot(17 - 10, 17 - 10);   // 角 (10,10) からの距離
  assert.ok(Math.abs(overlapOf(c, q, 0) - (5 - d)) < 1e-9, `角の判定がずれている（${overlapOf(c, q, 0).toFixed(3)}）`);
});

ok('relax も混在を押し離せる', () => {
  const m = relax([{ id: 'c', x: 0, y: 0, r: 10 }, { id: 'q', x: 2, y: 0, w: 20, h: 20 }], { iterations: 300, gap: 1 });
  assert.ok(overlapOf(m.get('c'), m.get('q'), 0) <= 0.5, '混在だと押し離せない');
});

console.error(`test: ${n} pass`);
