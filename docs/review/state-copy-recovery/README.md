# 状態画像の復旧方式：レビュー資料

1. `実行前レビュー.md`：採用方針、現行の保証範囲、残る条件、実行前の観測・費用・権限・受入
2. `model.py` と `model-results.json`：安全な24条件と危険な6変形の有限状態探索
3. `sdk-wire-check.mjs` と `sdk-wire-results.json`：実 SDK の条件 header 等のローカル確認

対象の実装は a847ba15dfd33105d00c13bf2fa547315840b0dd。
この資料は別の docs-only branch で作成し、実行コード、migration、設定を変更していない。
資料の版とファイルの SHA-256 は配布時の manifest を参照する。

## 再実行

Python 3 の標準ライブラリだけで model.py を実行できる。

    python3 model.py

SDK の確認は、対象 Lyra checkout に既にインストールされた依存を使用する。
AWS SDK 3.1066.0、Node 24.19.0 で確認した。自動 install は行わない。

    node sdk-wire-check.mjs

後者は架空の資格情報と in-process handler を明示指定し、ネットワークを呼ばない。
実 endpoint や本物の資格情報へ置き換えて実行する手順ではない。

モデルは前提を明示した抽象設計検査であり、実 S3／IAM の受入を置き換えない。
実サービス設定変更・費用発生・データ消去・公開は別途承認と検証が必要。
