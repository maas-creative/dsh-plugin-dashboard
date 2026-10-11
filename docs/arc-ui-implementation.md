# Arc UI を参照した Dashboard 改善

2026-10-11。React への移行や Arc のソース導入をせず、既存の vanilla JavaScript の操作・台帳モデルを維持して実装した。

## 参照と権利

一次資料は [Chat thread](https://uiarc.dev/components/chat-thread)、[Inbox triage](https://uiarc.dev/components/blocks/inbox-triage)、[Arc UI](https://uiarc.dev/)、[License](https://uiarc.dev/license)。Chat thread の左右配置、会話と入力欄の分離、最新メッセージへの移動、キーボード操作、reduced motion を参考にした。Inbox の密度と主従の区分を作業・成果物ペインに適用した。既存のスクロール追従、履歴・下書き維持はそのまま利用する。

公式 License は無料コンポーネントを MIT、Pro を別ライセンスとする。今回 Arc のコード、CSS、画像、Pro ブロックは複製していない。配色・余白・境界・角丸・書体のトークンと CSS は独自に記述した。License ページの取得結果は `work/arc-ui/arc-license.txt`。既存 DADS の来歴は既存 THIRD_PARTY_NOTICES に委ねる。

## 実装

全画面に共通する色・余白・見出し・カード・ボタン・表・サイドナビの階層を整えた。今日のエージェント は中央に会話と入力欄、右に成果物と担当エージェント を配置し、スマホでは縦に並べる。フォーカスと reduced motion の扱いを明示した。

Scrum の接続表示は `runtime.scrumConnected` の実値を使う。HardTackle の実行状況を確認できる公開状態 API は現在ないため「実行状態未確認」と表示する。Scrum 接続時のみ DSH の `/hdt` を案内する。`/api/ulw-pause` は現行 bridge の公開 handle 操作に接続していないため、親実行の停止ボタンは設けない。確認された担当実行の停止は既存 `assignment-stop` を維持し、担当カード上部へ移した。

質問選択肢の表示関数は独立に記述し直した。30 UTF-16 単位の表示制限、サロゲート対の保護、同じ省略ラベルの番号識別、回答 value と accessible name の完全保持、HTML エスケープを検証した。

## 検証

- `work/arc-ui/focused-tests.log`: UI、サイド会話、質問ラベルの検証。
- `work/arc-ui/browser-regression.log`: 実際の Chromium と隔離した一時 DB でプロジェクト・作業・階層・締切の変更履歴・提出受付分離を検証。
- `work/arc-ui/verify.mjs` と `result.json`: 隔離サーバー上の明示的な会話 fixture で、キーボード送信、下書きクリア、接続と未確認状態の区別、担当 Stop、モバイル横溢れなし、reduced motion、入力フォーカス、ブラウザー例外なしを検証。
- `desktop-1440.png`、`mobile-390.png`、`portfolio-1440.png`: fixture の実際のブラウザー画面。実運用の進捗を示す画像ではない。各画像を目視して会話・入力欄・担当欄・スマホの配置を確認した。

Ponytail review を参照し、既存 API 呼出し、権限境界、ポーリングでのフォーカス・下書き保持、HTML エスケープを照合した。新規データ書込み経路や依存は追加していない。常駐環境の再起動・配備はこの作業では行っていない。
