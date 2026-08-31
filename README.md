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

## デモ

**<https://opaopa6969.github.io/haichi-engine/>** — 壊れた配置と直した配置を並べて見られる。
スライダーで幅を縮めると、何がどう壊れるかが数値で出る。3D の街も視点を動かせる。

**このページはビルドしていない。**ブラウザが `index.js` をそのまま読んでいる（依存ゼロなので成立する）。

## 読むもの

| | |
|---|---|
| **[使い方](./docs/usage.ja.md)** | 場面ごとのレシピ。**載っているコードは全部そのまま動く**（`docs/examples.mjs` で実行して確かめている） |
| **[仕組み](./docs/internals.ja.md)** | 中で何が起きているか、なぜこの設計なのか、実地で見つかった欠陥、まだ無いもの |
| **[測定規則](./docs/rules.ja.md)** | `measure` / `measure3` が返す 18 の規則。閾値と直し方の全リファレンス |

この README は入口。API の一覧と設計契約だけ置いてある。

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

| 関数 | 何をするか |
|---|---|
| `fitText(str, width, cw)` | 幅に収まるところまで切り「…」を付ける。「…」すら入らないなら空を返す |
| `textWidth(str, cw)` | 文字幅の見積り（全角は 1.75 倍）。`fitText` と同じ単位で数える |
| `contentWidth(s, pad)` | 文字を置ける幅。`pad` か `contentW` を渡せば **`w - 6` の決め打ちをしない**（Web の padding / border 用） |
| `wrapText(str, w, cw, opts)` | 折り返して何行になるかを返す。日本語の禁則（行頭・行末に来てはいけない文字）を見る |
| `graphemes(str)` | 書記素（人が「1 文字」と感じる単位）に割る。ZWJ 連結の絵文字・国旗・肌の色・結合文字・異体字セレクタを 1 つに数える |
| `overlapOf(a, b, gap)` | **形が違っても正しく測る重なり量**。円×矩形は矩形上の最近点との距離で測る（円は「幅も高さも 2r の矩形」ではない） |
| `circleOverlap` / `rectOverlap` | 同じ形どうしの重なり量 |
| `rng(seed)` | seed 固定の擬似乱数（mulberry32） |

3D 側には `overlapOf3(a, b, gap)`（球×直方体）と `dist3(a, b)` がある。

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

## 集約（`haichi-engine/cluster`）

配置の**前段**。数百を数百のまま置く方法は無いので、置く前に数を減らす。

```js
import { splitBySize, groupBy, cluster, summarize } from 'haichi-engine/cluster';

// 入口が 30 個に収まるまで、大きすぎる塊を割る
splitBySize(children, { maxEntry: 30, maxBlock: 120, strategies });
```

| | |
|---|---|
| `splitBySize(children, opts)` | 入口が収まるまで木を割る。**割れないものは skip して次に大きいものを試す** |
| `groupBy(items, opts)` | 束ね方を順に試す。**偏ったら次の戦略へ** |
| `cluster(ids, edges, opts)` | 依存の強さで群を作る。**木が無い／木が意味を持たない**場合はこちら |
| `summarize(items, opts)` | 群の代表（数・規模・最も多い性質） |

**意味の判断は呼ぶ側が戦略として渡す。** engine が持つのは「順に試して、うまく割れたものを採る」というメカニズムだけ（契約「何であるかを知らない」を守るため）。

閾値は `cognitive` の `COGNITIVE` と同じ根拠から来る。**同じ根拠のものを別 repo に置くと定数を二重管理する**ので同居させている。

実測（zumen の 158 リポジトリ、CodeCity の入口）: `C201`/`C202`/`C204`/`C205` が **154 → 3 件**。

## 認知の評価（`haichi-engine/cognitive`）

**数百を数百のまま見せる方法は存在しない。**手は 3 つしかない。

1. **N を減らす**（集約する）
2. **記号の意味を変える**（1 個の点が 1 クラスであることをやめる）
3. **焦点と文脈を分ける**（全部を同じ解像度で見るのをやめる）

どれも取らずに 500 個を並べたものを「破綻」と呼び、**どれを取るべきかを返す**。

```js
import { cognitive, navigable, seriate, bandwidth } from 'haichi-engine/cognitive';

cognitive({ kind: 'node-link', nodes: 600, edges: 1200 });
// → problems: C101 一度に 600 個 / C102 node-link の限界（40）超 / C105 集約も焦点も無い
//   advice:  matrix（数百を「模様」として読める唯一の方法）
```

| | |
|---|---|
| `cognitive(view)` | 見せ方が破綻していないか。`C101` 出しすぎ / `C102` 毛玉 / `C103` 辺が密 / `C104` 並べ替えていない / `C105` 手を 1 つも取っていない / `C106` 入れ子が深い / `C107` スクロールしすぎ |
| `navigable(nav)` | **眺められることと、辿り着けることは別**。`C201` 入口が多い / `C202` 1 ブロックに詰めすぎ / `C203` 検索が無い / `C204` 絞れない / `C205` 現在地が分からない |
| `seriate(ids, edges)` | **並べ替え。行列とリストの品質はここで決まる**。スペクトル法、決定論的 |
| `bandwidth(order, edges)` | 並べ替えの良さ。辺が対角からどれだけ離れているか（ランダム順で約 0.33） |
| `recommend(view)` | その規模で何を選ぶべきか |

実測（zumen の 174 リポジトリ）: `seriate` で帯域幅が **0.20 → 0.09（54% 改善）**。
CodeCity は入口 41 個で `C201`、現在地表示が無く `C205` が出る。

## Web（`haichi-engine/web`）

**engine 本体は DOM を知らない**ので、実測はこの層が受け持つ。

```js
import { collect } from 'haichi-engine/web';        // ブラウザ側で測る
import { checkSnapshot } from 'haichi-engine/web';  // どこでも（node でも）検査する
```

間にあるのは素の JSON なので、**測る側と判定する側を別のマシン・別の時点にできる**。
`W201` 1 行に入らない / `W202` 折り返すと高さを超える / `W203` 文字が小さい / `W204` 意図しない横スクロール。
`checkResponsive` は複数の画面幅で検査して、**どの幅で壊れるか**を返す。

**ブラウザ無しに測れないものがある**ことが要点で、`collect()` は node では理由を言って落ちる。
Grid / Flex / `clamp()` 後の実座標も、実フォントの幅も、日本語の折返し行数も、ブラウザに測らせるしかない。

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

v0.4.0。2D 71 / 3D 22 / zumen 連携 5 / game 連携 15 / Web 連携 11 / 認知 21 / 集約 14 / 町 80 / 地形 16 / 植生 13 / 認知地図 14 / 樹形 45 / 文書の実行 11 / 文書の整合 5 の計 352 テスト。\n\n文書に載せたコードは `docs/examples.mjs` が実際に実行し、規則と API の一覧は `docs/check-docs.mjs` が実装と突き合わせる。**文書が嘘をつくのを機械で止めている。**

```
npm test
```

## License

MIT
