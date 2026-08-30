// Web adapter のテスト。collect() はブラウザでしか動かないので、
// **その出力形式（素の JSON）を手で組んで** checkSnapshot を検査する。
// この分離自体が設計の要点で、測る側と判定する側を別の時点にできる。
import assert from 'node:assert/strict';
import { checkSnapshot, checkResponsive, collect } from './web.mjs';

let n = 0; const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`NG ${name}: ${e.message}`); process.exitCode = 1; } };

const snap = (shapes, viewport = { width: 1280, height: 800 }) => ({
  viewport, at: '2026-01-01T00:00:00Z',
  bounds: { x: viewport.width / 2, y: viewport.height / 2, w: viewport.width, h: viewport.height },
  shapes,
});
const box = (o) => ({ tag: 'div', wrap: true, scrollX: false, scrollY: false, overflow: 'visible', font: 16, ...o });

ok('collect はブラウザ以外で明確に落ちる', () => {
  // node には document も getComputedStyle も無い。黙って壊れず、理由を言って落ちること
  assert.throws(() => collect(), (e) => /ブラウザ|document|getComputedStyle/.test(String(e)));
});

ok('nowrap で 1 行に入らないと W201', () => {
  const s = snap([box({ id: 'btn', x: 100, y: 40, w: 120, h: 40, contentW: 88, contentH: 16,
    label: '送信して次のステップへ', wrap: false, measuredW: 220 })]);
  const r = checkSnapshot(s);
  const p = r.problems.find((x) => x.code === 'W201');
  assert.ok(p, '溢れているのに黙った');
  assert.match(p.message, /実測 220px > 内寸 88px/);
  assert.equal(r.metrics.overflowX, 1);
});

ok('横スクロールできるなら W201 を出さない', () => {
  const s = snap([box({ id: 'bar', x: 100, y: 40, w: 120, h: 40, contentW: 88, contentH: 16,
    label: 'ながい', wrap: false, measuredW: 220, scrollX: true, overflow: 'auto' })]);
  assert.ok(!checkSnapshot(s).problems.some((p) => p.code === 'W201'));
});

ok('折り返して高さを超えると W202', () => {
  const s = snap([box({ id: 'card', x: 200, y: 100, w: 240, h: 60, contentW: 216, contentH: 36,
    label: '配置と、配置が読めるかの測定。これは折り返しの検査です、行数が問題になります。',
    font: 14, lineHeight: 22, measuredW: 560 })]);
  const r = checkSnapshot(s);
  const p = r.problems.find((x) => x.code === 'W202');
  assert.ok(p, '溢れているのに黙った');
  assert.match(p.message, /行になり/);
  assert.equal(r.metrics.overflowY, 1);
});

ok('縦スクロールできるなら W202 を出さない', () => {
  const s = snap([box({ id: 'card', x: 200, y: 100, w: 240, h: 60, contentW: 216, contentH: 36,
    label: 'ながい文章'.repeat(20), font: 14, lineHeight: 22, scrollY: true, overflow: 'auto' })]);
  assert.ok(!checkSnapshot(s).problems.some((p) => p.code === 'W202'));
});

ok('小さすぎる文字は W203（Web の既定は 12px）', () => {
  const s = snap([box({ id: 'note', x: 100, y: 40, w: 200, h: 20, contentW: 200, contentH: 20, label: '注記', font: 9 })]);
  const r = checkSnapshot(s);
  assert.ok(r.problems.some((p) => p.code === 'W203'), '9px を見逃した');
  assert.equal(r.metrics.tinyText, 1);
  // 図の既定（9px）より厳しいことを確かめる
  assert.ok(!checkSnapshot(s, { minFont: 9 }).problems.some((p) => p.code === 'W203'));
});

ok('意図しない横スクロールは W204', () => {
  const s = snap([box({ id: 'wrap', x: 200, y: 100, w: 300, h: 100, contentW: 300, contentH: 100, scrollX: true, overflow: 'visible' })]);
  assert.ok(checkSnapshot(s).problems.some((p) => p.code === 'W204'));
});

ok('実測値が無ければ見積りに落ちる', () => {
  const s = snap([box({ id: 'x', x: 100, y: 40, w: 60, h: 30, contentW: 40, contentH: 16,
    label: 'とてもながいラベル', wrap: false })]);   // measuredW なし
  assert.ok(checkSnapshot(s).problems.some((p) => p.code === 'W201'), '見積りでも検出できるはず');
});

ok('綺麗な画面には文句を言わない', () => {
  const s = snap([
    box({ id: 'title', x: 640, y: 60, w: 400, h: 40, contentW: 400, contentH: 40, label: '見出し', font: 28, measuredW: 90 }),
    box({ id: 'body', x: 640, y: 200, w: 600, h: 200, contentW: 600, contentH: 200, label: '本文です。', font: 16, lineHeight: 26, measuredW: 90 }),
  ]);
  const r = checkSnapshot(s);
  assert.deepEqual(r.problems, [], JSON.stringify(r.problems));
});

ok('checkResponsive は幅ごとに数え、最悪の幅を返す', () => {
  const wide = snap([box({ id: 'c', x: 640, y: 100, w: 600, h: 60, contentW: 600, contentH: 40,
    label: '横に長い見出し', wrap: false, font: 20, measuredW: 300 })], { width: 1280, height: 800 });
  const narrow = snap([box({ id: 'c', x: 187, y: 100, w: 340, h: 60, contentW: 340, contentH: 40,
    label: '横に長い見出し', wrap: false, font: 20, measuredW: 300 })], { width: 375, height: 667 });
  const tiny = snap([box({ id: 'c', x: 100, y: 100, w: 160, h: 60, contentW: 120, contentH: 40,
    label: '横に長い見出し', wrap: false, font: 20, measuredW: 300 })], { width: 320, height: 568 });
  const r = checkResponsive([{ width: 1280, snapshot: wide }, { width: 375, snapshot: narrow }, { width: 320, snapshot: tiny }]);
  assert.equal(r.byWidth[1280], 0, '広い幅で問題が出た');
  assert.ok(r.byWidth[320] > 0, '狭い幅で問題が出ていない');
  assert.equal(r.worst.width, 320, `最悪の幅が ${r.worst.width}`);
});

ok('スナップショットは保存して後から検査できる（DOM に触らない）', () => {
  const s = snap([box({ id: 'a', x: 100, y: 40, w: 120, h: 40, contentW: 88, contentH: 16, label: 'x', wrap: false, measuredW: 220 })]);
  const roundTripped = JSON.parse(JSON.stringify(s));
  assert.deepEqual(checkSnapshot(roundTripped).problems.map((p) => p.code), checkSnapshot(s).problems.map((p) => p.code));
});

console.error(`web: ${n} pass`);
