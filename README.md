# haichi-engine

**English** · [日本語](./README.ja.md)

> 「**どこに置くか**」だけを決める小さな純粋幾何エンジン。描画はしない。
> 置いた結果が**読めるかどうかを測って返す**のが、他の配置ライブラリと違うところ。

```js
import { pack, treemap, relax, placeLabels, measure } from 'haichi-engine';

const placed = pack(items, { size: 1000 });
const report = measure(shapes, edges);
// → { problems: [{ code:'H102', id, message:'…が 12.3px はみ出す（文字 88px > 使える幅 76px）— fitText() を通すか図形を広げる' }],
//     metrics: { overlaps, overflow, unreadable, crossings, pierces, aspect } }
```

## 設計契約

- **何であるかを知らない。** 入力は「大きさを持つもの」と「つながり」だけ。クラスでも、すごろくのマスでも、UI パネルでも、麻雀卓の席でも同じに扱う。
- **描画しない。** DOM も canvas も three.js も触らない。返すのは座標と測定値だけ。誰がどう描くかは下流が決める。
- **決定論的。** 同じ入力からは必ず同じ座標が出る。乱数を使う関数は `seed` を必ず取る。
- **依存ゼロ。** `node test.mjs` だけで全部走る。
- **測定のメッセージには必ず実測値・閾値・直し方を入れる。** 読むのは人か LLM で、メッセージだけを見て直せないと意味がない。

## なぜ「測る」のか

座標を出す道具は世に多い。足りないのは**出した配置が読めるかを測る**道具で、そこが実際に事故を生む。

zumen（ソフトウェア構造の可視化）で実測したところ、174 リポジトリの図に **8,842 件の「読めない箇所」**があった。原因は 2 つとも、目視では気付けない種類のものだった。

1. 文字を切り詰める関数が、省略記号を幅計算の**外**で足していた。切り詰めた結果が幅を 1 文字ぶん超え続けていた
2. ラベルを出すかどうかを**半径**で判断していたため、小さい図形は文字サイズの下限で頭打ちになり、閾値をいくら上げても 6.8px で描かれ続けていた

どちらも「データは正しいが図が読めない」型の欠陥で、IR（中間表現）の検証では絶対に捕まらない。**配置と同じ場所で測る**しかない。

## 前提と単位（読む前に）

- **長さは全部 px。** `r` / `w` / `h` / `font` / `gap` は同じ尺度なら何でもよいが、既定値（`minFont: 9`）は px を想定している。
- **`cw` は「font に掛ける文字幅の係数」**（既定 0.55）。`font * cw` が半角 1 文字の幅、全角はその 1.75 倍として数える。等幅でない前提の粗い見積り。
- **`measure` は既定ではラベルが図形の「中」にあるものとして見る。** 図形の外に置いているなら `shapes[].labelBox = {x,y,w,h}` を渡すこと。渡さないと、外置きの重なりは原理的に見えず「問題なし」と報告される（tetsugo で実際に踏んだ落とし穴）。
- **`measure` は O(n²)。** 実測で 3,583 図形 × 3,706 辺が 588ms。数千までは実用、万を超えるなら `spatialHash` で近傍だけに絞ってから渡す。
- **決定論的。** 乱数を使うのは `rng` と `relationMap` だけで、どちらも `seed` を取る。同じ入力からは必ず同じ座標が出る。

### 座標系

- **`x, y` は図形の中心。** CSS の `left/top`（左上）とは違うので、DOM に渡すときは `left = x - w/2` に直す。
- **`y` は下向き**（画面座標）。そのため見た目の時計回りは**角度を減らす**方向になる。`roundTable` の `clockwise` はこれを吸収している。
- `measure` の `bounds` / `scrollable`: 領域を渡すと `H110`（領域外へのはみ出し）を見る。手牌のように一列＋スクロールが正しい用途では `scrollable: true` を渡すと `H106`（極端な縦横比）を出さない。

## ゲーム向けの入口（`integration/game-board.mjs`）

| 関数 | 何をするか |
|---|---|
| `roundTable(players, opts)` | 円卓に n 人を等間隔。**既定は時計回り**（麻雀の座順）。`seatSize` で矩形の席域（細長い席を外接円で近似すると偽の重なりが出る） |
| `alongPath(cells, path, opts)` | 路に沿ってマスを並べる。`{ grid, orthogonal }` で整数格子・斜め禁止を守る。`path` を `[{from,to,cells}]` で渡せば**区間ごとのマス数**を指定できる（すごろくは駅間の距離がゲームそのものなので） |
| `speechBubbles(anchors, opts)` | 吹き出しを話者の近くに、重ねずに |
| `relationMap(nodes, ties, opts)` | 関係の強さで距離を決める。`seed` 固定 |

## API

### 配置

| 関数 | 何をするか | 使いどころ |
|---|---|---|
| `pack(items, opts)` | 円詰め。入れ子を再帰的に | 包含関係（パッケージ ⊃ クラス） |
| `tree(items, opts)` | 階層。親を子の中央に | 継承・依存の向きを見せたいとき |
| `treemap(items, opts)` | squarified treemap | 量の比較、街区の生成 |
| `relax(items, opts)` | 重なりを押し離す。`axis` `maxMove` `grid` `bounds` で縛れる | 既にある座標を微調整する。**`bounds` を渡すと領域の外へ押し出さない**（外に出して重なりを消すのは解決ではない） |
| `grid(items, opts)` | 順序を保って並べる（row / column / grid）。`cols` で折返し、`gapAfter` で個別の間隔 | 手牌・河・ツールバーのように**順番が意味を持つ**もの。入りきらない量は `overflow` で返す（勝手に縮めない） |
| `placeLabels(shapes, opts)` | ラベルを中／周囲 8 方向へ。`prefer:'outside'` `allowInside` `dirOrder` `priority` で方針を変えられる | **内に入るかは切り詰める前の全長で判断する**（切り詰めた「…」で判定すると全部内側に詰まる）。置けなければ `hidden: true` |

### 測定

`measure(shapes, edges, opts)` → `{ problems, metrics }`

| 符号 | 何を見るか |
|---|---|
| `H101` | 図形どうしの重なり（入れ子は重なりではないので `parent` が同じものだけ比べる） |
| `H102` | ラベルが図形からはみ出す／1 文字も入らない |
| `H103` | 文字が読める最小サイズを下回る |
| `H104` | 辺の交差が多すぎる（全対の 15% 超） |
| `H105` | 辺が無関係な図形を貫いている |
| `H106` | 縦横比が極端（6:1 超） |

### 道具

`fitText` / `textWidth` / `circleOverlap` / `rectOverlap` / `rng`（seed 固定の mulberry32）

## 3D（`haichi-engine/3d`）

```js
import { blocks, relax3, project, visibleFrom, measure3, semanticLod } from 'haichi-engine/3d';
```

3D で新しく問題になるのは 3 つで、2D の指標をそのまま持ち込んでも測れない。**どれも視点を与えないと測れない**ので `measure3` は camera を取る。

1. **遮蔽** — 手前の物が奥の物を隠す。「置いてあるのに見えない」は 2D には無い
2. **通行** — 人が歩くなら、隙間が狭いと通れない
3. **距離による可読性** — ラベルの大きさは距離で決まる。遠い字は読めない

| 配置 | 測定 |
|---|---|
| `blocks` 区画に建物を建てる（CodeCity 方式。平面は treemap、高さは別の量） | `V101` 立体の重なり |
| `relax3` 3D の重なり解消（y は既定で動かさない＝地面に建つ） | `V102` **通れない隙間** |
| `project` 透視投影（three.js を使わない純粋な数式） | `V103` 手前の物に完全に隠れている |
| `visibleFrom` 視錐台の外と、完全に隠れたものを落とす | `V104` この距離ではラベルが読めない |
| `semanticLod` **画面占有**で開閉を決める（距離ではない）。ヒステリシス付き | `V105` ラベルが画面上で置き場所を失う |
| `spatialHash` 近傍だけを引く格子 | `V106` ラベルが図形からはみ出す |
| `lodFor` 距離から LOD の段 | `V107` 高さの落差が極端 |

ラベルの可読性と重なりは、**画面へ投影してから 2D の道具（`placeLabels` / `measure`）に渡す**。同じ問題なので同じ道具を使う。

### 実測

zumen の CodeCity（コードを建物に見立てた 3D ビュー）4 リポジトリに当てたところ **930 件**。内訳は `V102` 通れない隙間 854 / `V101` 重なり 66 / `V103` 遮蔽 4 / `V104` 読めないラベル 4。zumen には一人称歩行があるので、V102 はそのまま「入れない街区」を意味する。

## つなぎ方（`integration/`）

依存の向きは**下流 → haichi の一方向**。haichi は相手のデータ形式を知らないので、変換はこのディレクトリが持つ。

### `zumen-layout.mjs` — [zumen](https://github.com/opaopa6969/zumen) と

ZIR（描画非依存の JSON）を入れ子に畳み、配置と測定を返す。`unit` は `parent`（module）ではなく `component` に帰属させる（ZIR §4.2）。component をまたぐ呼び出しだけを辺にする（全部引くと読めない）。

### `game-board.mjs` — [game-engine-suite](https://github.com/opaopa6969/game-engine-suite) と

ゲーム側で「ものをどこに置くか」が要る場面は、可視化と同じ問題に帰着する。

| 関数 | 想定する相手 |
|---|---|
| `roundTable(players, opts)` | 円卓の席順。入りきらなければ重なりを報告する（janshin） |
| `alongPath(cells, path, opts)` | 路に沿ってマスを並べる。すごろくの盤面（tetsugo） |
| `speechBubbles(anchors, opts)` | 吹き出しを話者の近くに、重ねずに（drama-engine） |
| `relationMap(nodes, ties, opts)` | 関係の強さで距離を決める（relation-engine） |

## 立ち位置

```
  データを持つもの            haichi-engine        描くもの
  ─────────────────         ──────────────      ──────────
  zumen（ZIR）        ──▶   座標を決める   ──▶  SVG / three.js
  tetsugo（盤面）     ──▶   読めるか測る   ──▶  canvas
  janshin（卓）       ──▶                  ──▶  DOM
  drama-engine（台詞）
```

## 状態

v0.0.2。2D 42 / 3D 20 / zumen 連携 5 / game 連携 13 の計 80 テスト。

```
npm test
```

## License

MIT
