# Entity reference response contract 接続設計

## 目的と範囲

Entity参照画像フローの既存JSON応答を共有Mobile API contractへ接続し、S3内部情報を公開せず、契約外Service値を成功データとして返さない。

対象:

- 参照セット取得、確定、削除後の3応答
- 画像import解析応答
- 参照画像生成job受付応答

認証済みbinary image export、token形式、署名処理、upload、生成job実装、Service / Repository / DBは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Architecture / Files and Images / Long Running Jobs / Security / Test and Verification
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: reference set、import解析、生成受付の3 schemaを追加する。
- Route: 既存mapper/token生成後、HTTP送信直前に共有contractを検証する。
- Infrastructure / Service / Repository / Domain / DB / Web / Mobile: 変更しない。
- request、HTTP status、wire field、認証・組織認可、監査ログを維持する。

## 互換境界

- reference setは`empty` / `partial` / `ready`を許可し、画像0件とprimary nullを維持する。
- 署名できない場合に`cdn_url`が省略される現行挙動を正常値とする。
- `source`は現行`upload` / `generated`だけを許可する。
- importのsuggested fieldsは任意key/value object、tokenは非空文字列とする。
- 生成受付job IDは非空文字列とする。
- `s3_key`、候補元URL、ユーザーIDをresponse schemaへ含めない。

## セキュリティ

- 既存auth、organization `view_work` / `edit_work` / `generate`を維持する。
- 候補tokenのscope/signature検証、S3 ownership、署名URL処理を変更しない。
- raw image、S3 key、token secret、provider error、検証詳細をログ・応答へ追加しない。

## TDDと検証

1. 3 schemaの正常・境界値と内部key拒否を先にテストする。
2. 参照セット3 endpoint、import、生成受付の全5 endpointが契約外Service値を500にするテストを先に追加し、失敗を確認する。
3. contractとRoute guardだけを実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。単一Routeと共有mapper/token出力のresponse-only変更で、S3非開示を同一レビューで確認する必要があるため、Solローカルチェックリストで実施する。
