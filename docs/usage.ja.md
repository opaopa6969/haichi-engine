# 使い方

場面ごとのレシピ。**ここに載っているコードは全部そのまま動く**（`docs/examples.mjs` で実行して確かめている）。

- [入れる](#入れる)
- [1. 入れ子の構造を円で見せる](#1-入れ子の構造を円で見せる)
- [2. 領域を隙間なく矩形に割る](#2-領域を隙間なく矩形に割る)
- [3. 重なりを解消する](#3-重なりを解消する)
- [4. 順番が意味を持つものを並べる](#4-順番が意味を持つものを並べる)
- [5. ラベルを置く](#5-ラベルを置く)
- [6. 配置が読めるか測る](#6-配置が読めるか測る)
- [7. 立体を建てて、見えるか測る](#7-立体を建てて見えるか測る)
- [8. ゲームの盤面・卓](#8-ゲームの盤面卓)
- [よくある落とし穴](#よくある落とし穴)

---

## 入れる

依存ゼロの ESM。ビルドも不要。

```js
import { pack, treemap, relax, grid, placeLabels, measure } from 'haichi-engine';
import { blocks, project, visibleFrom, measure3 } from 'haichi-engine/3d';
import { roundTable, alongPath } from 'haichi-engine/game-board';
```

リポジトリを直接参照するなら相対パスで。

```js
import { pack } from '../haichi-engine/index.js';
```

---

## 1. 入れ子の構造を円で見せる

パッケージ ⊃ クラス、部署 ⊃ 人、といった**包含関係**を見せたいとき。

```js
import { pack } from 'haichi-engine';

const items = [
  { id: 'core', children: [
      { id: 'Engine', value: 300 },   // value は面積の重み
      { id: 'util',   value: 40 },
  ]},
  { id: 'io', children: [{ id: 'read', value: 60 }] },
];

const placed = pack(items, { size: 600, padding: (depth) => (depth === 0 ? 12 : 4) });
for (const [id, c] of placed) {
  console.log(id, `中心(${c.x.toFixed(0)}, ${c.y.toFixed(0)}) 半径 ${c.r.toFixed(0)} 深さ ${c.depth} 親 ${c.parent}`);
}
```

- **子は必ず親の円に収まる**（テストで保証している）
- `padding(depth)` で階層ごとに隙間を変えられる
- 同じ入力からは必ず同じ座標が出る

---

## 2. 領域を隙間なく矩形に割る

タイリング、ダッシュボードのタイル、街区の区画。**面積が値に比例する**。

```js
import { treemap } from 'haichi-engine';

const cells = treemap(
  [{ id: 'a', value: 5 }, { id: 'b', value: 3 }, { id: 'c', value: 2 }],
  { x: 0, y: 0, w: 800, h: 400, padding: 4 },
);
// → Map<id, { x, y, w, h, depth, parent }>   x,y は「中心」
```

`children` を持たせれば再帰的に割る。DOM に渡すときは中心から左上へ直すこと。

```js
const c = cells.get('a');
el.style.left = `${c.x - c.w / 2}px`;
el.style.top  = `${c.y - c.h / 2}px`;
```

---

## 3. 重なりを解消する

**すでに座標があって**、重なりだけ直したいとき。ゲームの broad phase と同じで、重なった対を押し離す。

```js
import { relax } from 'haichi-engine';

const settled = relax(items, {
  gap: 4,                       // 最低限あけたい隙間
  maxMove: 30,                  // 元の位置から 30px 以上動かさない
  axis: 'x',                    // x 方向にだけ逃がす（'y' / 'xy'）
  bounds: { x: 400, y: 300, w: 800, h: 600 },  // この領域から出さない
  grid: 40,                     // 最後に 40px 格子へ載せ直す
  pinned: new Set(['fixed-1']), // これは動かさない
});
```

**`bounds` を渡すこと。** 渡さないと、重なりを消すために外へ押し出す解を「成功」として返す。画面に入らない配置は解決ではない。

---

## 4. 順番が意味を持つものを並べる

手牌、ツールバー、タブ。**押し離しでは並べられない**（順序が壊れる）。

```js
import { grid } from 'haichi-engine';

const tiles = Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, w: 36, h: 52 }));
tiles[12].gapAfter = 20;        // ツモ牌の前だけ空ける

const { items, rows, width, overflow } = grid(tiles, {
  x: 0, y: 0, gap: 4,
  bounds: { w: 355, h: 200 },   // 幅を超えたら折り返す
  align: 'center',
});
if (overflow > 0) console.log(`${overflow}px 入りきらない`);
```

`cols` を渡せば固定列数で折り返す。**入りきらない量は `overflow` で返すだけで、勝手に縮めない**。縮めるか、スクロールにするか、数を減らすかは呼ぶ側が決めること。

---

## 5. ラベルを置く

図形の中に入るなら中、入らないなら周囲 8 方向。**どこにも置けなければ `hidden: true` を返す。**

```js
import { placeLabels } from 'haichi-engine';

const labels = placeLabels(stations, {
  minFont: 9,            // これ未満の字は出さない
  prefer: 'outside',     // 中に入っても外に出す
  dirOrder: [[0, 1], [0, -1], [1, 0], [-1, 0]],  // 下→上→右→左の順で試す
});

for (const [id, l] of labels) {
  if (l.hidden) continue;        // 出さない判断も配置の一部
  draw(l.text, l.x, l.y, l.font);
}
```

`priority` を付けると、その順に置き場所を取る（重要なラベルを先に確保する）。

```js
{ id: 'tokyo', x: 100, y: 200, r: 6, label: '東京', font: 12, priority: 10 }
```

---

## 6. 配置が読めるか測る

**このエンジンの本体。** 座標を出す道具は世に多いが、出した配置が読めるかを測る道具は少ない。

```js
import { measure } from 'haichi-engine';

const { problems, metrics } = measure(shapes, edges, {
  minFont: 9,
  bounds: { x: 400, y: 300, w: 800, h: 600 },
  scrollable: false,
});

for (const p of problems) console.log(p.code, p.message);
// H102 hokkaido のラベル「北海道地方全域」は使える幅 10px に 1 文字も入らない（必要 81px）
//      — 図形を広げるか、placeLabels() で外に出すか、この深さでは名前を出さない
```

**メッセージには必ず実測値・閾値・直し方が入る。**読むのが人でも LLM でも、メッセージだけを見て直せなければ意味がないから。

規則の一覧は [測定規則](./rules.ja.md)。

### 図形の外にラベルを置いているとき

既定では「ラベルは図形の中」として見る。外に置いているなら `labelBox` を渡す。**渡さないと外置きの重なりは原理的に見えず、「問題なし」と報告される。**

```js
measure([
  { id: 'a', x: 0, y: 0, r: 5, label: '積丹岬', font: 12, labelBox: { x: 0, y: -20, w: 60, h: 14 } },
], []);
```

---

## 7. 立体を建てて、見えるか測る

3D で新しく問題になるのは 3 つ。**どれも視点を与えないと測れない。**

```js
import { blocks, measure3 } from 'haichi-engine/3d';

const city = blocks(items, { w: 1000, d: 1000, padding: 6, heightScale: 6 });
const objs = [...city.values()].map((b) => ({ ...b, label: b.node?.name }));

const camera = {
  x: -400, y: 700, z: 1500,
  target: { x: 500, y: 0, z: 500 },
  fov: 50, width: 1600, height: 900,
};

const { problems, metrics } = measure3(objs, [], camera, { walkWidth: 6, minFont: 9 });
console.log(metrics);
// { objects, overlaps, narrowGaps, occluded, visibleRatio, unreadableLabels, heightRatio }
```

- **遮蔽** — 手前の物が奥を隠す。「置いてあるのに見えない」は 2D に無い
- **通行** — `walkWidth` を渡すと、人が通れない隙間を報告する
- **距離による可読性** — ラベルの大きさは距離で決まる

### どこまで開くかを画面占有で決める

距離ではなく**画面に占める大きさ**で切り替える。ヒステリシス付きなので境界で点滅しない。

```js
import { semanticLod } from 'haichi-engine/3d';
let open = new Set();
function onCameraMove(camera) {
  ({ open } = semanticLod(objs, camera, { minPx: 24, hysteresis: 1.35, open }));
}
```

---

## 8. ゲームの盤面・卓

```js
import { roundTable, alongPath, speechBubbles, relationMap } from 'haichi-engine/game-board';
```

### 円卓（麻雀・カードゲーム）

```js
const { seats, report } = roundTable(
  [{ id: 'self' }, { id: 'right' }, { id: 'across' }, { id: 'left' }],
  { radius: 200, startAngle: Math.PI / 2, seatSize: { w: 160, h: 40 } },
);
```

**既定は時計回り**（麻雀の座順）。`seatSize` で矩形の席域を渡すこと — 細長い席を外接円で近似すると、空白ぶんで偽の重なりが出る。

### すごろくの盤面

```js
const { cells, path } = alongPath(
  squares,
  [ { from: { x: 0, y: 0 },   to: { x: 400, y: 0 }, cells: 8 },
    { from: { x: 400, y: 0 }, to: { x: 400, y: 320 }, cells: 6 } ],
  { grid: 40, orthogonal: true },
);
```

`grid` + `orthogonal` で**整数格子・斜め禁止**を守る。`path` を区間で渡せば**駅間のマス数**を指定できる（すごろくは駅間の距離がゲームそのものなので、全体を等分されると困る）。

### 吹き出し・関係図

```js
const { bubbles } = speechBubbles(anchors, { maxWidth: 220 });
const { nodes } = relationMap(people, ties, { seed: 7 });  // seed 固定＝毎回同じ絵
```

---

## よくある落とし穴

| 症状 | 原因 | 直し方 |
|---|---|---|
| `measure` が何も言わない | ラベルを図形の外に置いているのに `labelBox` を渡していない | `labelBox` を渡す |
| ラベルが全部「…」になる | `fitText` の結果を自分で内外判定に使っている | `placeLabels` に任せる。内外は**切り詰める前の全長**で決めるもの |
| 重なりは消えたが画面に入らない | `relax` に `bounds` を渡していない | `bounds` を渡す |
| 手牌の順番が入れ替わる | `relax` を使っている | `grid` を使う（順序を保つ） |
| 円と矩形が混ざると重なりを見落とす | 〜v0.0.2 のバグ | v0.0.3 以降を使う |
| 一列に並べたら「縦横比が極端」と怒られる | スクロール前提の配置 | `measure(..., { scrollable: true })` |
| DOM に置いたら位置がずれる | `x, y` は**中心** | `left = x - w/2`, `top = y - h/2` |
| 席順が左右逆 | 画面座標は `y` が下向き | `roundTable` は吸収済み。自前で角度を使うなら符号に注意 |
