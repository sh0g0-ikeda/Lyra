# Entity CRUD response contract 接続設計

## 目的と範囲

既存のEntity作成・一覧・単体取得・更新が返すwire payloadを共有Mobile API contractへ接続する。Character、nonhuman、objectを同じ現行Domain境界で検証し、契約外の内部成功値を配信しない。

対象:

- `POST /api/works/:work_id/entities`
- `GET /api/works/:work_id/entities`
- `GET /api/entities/:id`
- `PUT /api/entities/:id`

削除204、参照画像、import、生成job、pagination、Service / Repository / DBは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Architecture / Security / Test and Verification
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: 現行Entity wire itemと一覧wrapperを追加する。
- Route: `toEntityResponse`後、HTTP送信前に共有contractを検証する。
- Service / Repository / Domain / Infrastructure / DB / Web / Mobile: 変更しない。
- request、HTTP status、wire field、認証・組織認可、エラー形式を維持する。

## 互換境界

- IDとtimestampは既存共有contractと同じ非空文字列境界を使う。
- `free_description`と`prompt_supplement`はnullを許可する。
- `structured_fields`と`speech_profile`は任意key/valueのobjectを許可し、既存データを狭めない。
- typeは現行3種、statusは現行`draft` / `ready`だけを許可する。
- 空のobjectを正常値として維持し、内部`user_id`はwireへ追加しない。

## セキュリティ

- 既存auth、personal ownership、organization `view_work` / `edit_work`を維持する。
- user ID、内部履歴、raw payload、検証詳細を新たに返却・記録しない。
- upload、S3 key、生成job、クレジット、SQLは変更しない。

## TDDと検証

1. itemと空一覧wrapperの正常値、未知type/status、空ID、objectでないstructured fieldsを先にテストする。
2. 4 endpointすべてが契約外Service Entityを500にするテストを先に追加し、失敗を確認する。
3. contractとRoute guardだけを実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。単一wire mapperを共有する4 endpointのresponse-only変更であり、同一レビューで全配線を照合するほうが漏れを防げるため、Solローカルチェックリストで実施する。
