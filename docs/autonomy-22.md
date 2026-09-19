# #22 Builder 反復1の記録

取得・検証日: 2026-09-20（JST）。対象: haichi-engine のみ。

## 観測と判断

- 前回 worktree `autonomy-fan-mu8j5leg-4dl` は clean、追加 commit なし。open PR は0件。
- 起点は `bfce2171abaf3fb4010bdb3164c273a9c0383fb5`。main の CI は成功。
- 指定の `AGENTS.md`、`CLAUDE.md`、`docs/product-brief.md` は対象ツリーに不在。README と town の既存契約を基準とした。
- #21 は道沿いの歩幅を修正したが、配置失敗後の拡張量は `gap` に比例したまま。20棟・幅奥行き10・gap=0では scatter / organic / radial / riverine の全てが1秒でタイムアウトした。
- 仮説: 非正の拡張量で再試行上限に到達できない。非正値の場合だけ拡張量を1にして検証した。
- 実施: scatter の奥行きと沿道配置の外周を前進させ、既存の上限と `unplaced` を利用する。正の値は既存の計算を維持する。依存追加・実行基盤追加・全面移植は不要。

## 更新した終了要件と証拠

1. 狭い敷地で gap=0 / -0.1 が終了する。scatterGap の明示指定も検査する。
2. placed と unplaced が入力IDを重複・欠落なく保存し、決定論と有限座標を守る。
3. 正の gap の出力は維持する（4モード × gap=0.1 / 5 の全出力を起点と比較して一致）。
4. `node town.test.mjs`: 111通過。`npm test`: 全16スクリプト、573検査成功（Node v20.20.0）。
5. PR の最新 head で CI 成功を確認し、別セッションの Judge が証拠を検収する。accept 後のみ Finalizer が merge し、#22 を close する。

回帰テストは子プロセスを5秒で打ち切るため、ハングの再発も失敗として検知する。
変更前コードに同じテストを適用する比較では、タイムアウトを1秒に短縮して検査した。

## 再現手順

`npm test` は既存スクリプトを呼ぶだけで、install は不要。
正の gap の比較はリポジトリルートから次を実行する。

```sh
baseline=$(mktemp /tmp/haichi-baseline-XXXXXX.mjs)
git show bfce217:town.js > "$baseline"
BASELINE="$baseline" node --input-type=module <<'JS'
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { town } from './town.js';
const { town: before } = await import(pathToFileURL(process.env.BASELINE));
const items = Array.from({ length: 20 }, (_, id) => ({ id, value: 10 }));
for (const mode of ['scatter', 'organic', 'radial', 'riverine']) {
  for (const gap of [0.1, 5]) {
    const opts = { w: 10, d: 10, mode, gap };
    assert.deepEqual(town(items, opts), before(items, opts));
  }
}
console.log('8ケース一致');
JS
rm "$baseline"
```

## 引継ぎと制約

次の判断は Judge による accept / repair。Builder は merge しない。
非有限入力、極端な桁数、重複IDを含む入力の一般的な正規化は今回の対象外。
取り消しは Finalizer が作成する merge commit に `git revert -m 1 <merge-commit>` を適用したPRで行う。
時間・トークンの正確な使用量は実行側の Goal 記録を参照し、推測値は記載しない。

参照した外部情報（取得日はいずれも2026-09-20）:

- https://github.com/opaopa6969/haichi-engine/issues/22 — 自repoの運用記録。GitHub利用規約 https://docs.github.com/en/site-policy/github-terms/github-terms-of-service に従う。`gh issue view 22 --json body,comments,state` で再取得。
- https://github.com/opaopa6969/haichi-engine/actions/runs/35450856524 — main CI成功。上記GitHub利用規約。`gh run view 35450856524` で再取得。
- https://github.com/opaopa6969/haichi-engine/tree/bfce2171abaf3fb4010bdb3164c273a9c0383fb5 — 比較元のコード。MIT（repo の `LICENSE`）。`git fetch origin` と上記 `git show` で再現。
