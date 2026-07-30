# Mobile Balloon response contract design

## 目的と範囲

PR #67 の Mobile API response contract から、既存の Balloon API の成功応答
だけを独立して共通 Zod schema へ接続する。JSON wire payload、DB、Service、
認証・認可、入力検証を変更せず、Backend 内部が不正な Balloon を返した場合だけ
成功レスポンスを fail closed にする。

対象 endpoint:

- `POST /api/pages/:id/balloons`
- `GET /api/pages/:id/balloons`
- `POST /api/pages/:id/auto-balloons`
- `PUT /api/balloons/:id`

`DELETE /api/balloons/:id` は body のない 204 のため対象外とする。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §3: Route のレスポンス変換責務
- `docs/Lyra_Unified_Spec_v4.md` §4: personal ownership / organization membership
- `docs/Lyra_Unified_Spec_v4.md` §8: 出力の schema validation
- `docs/Lyra_Unified_Spec_v4.md` §10: release verification gate
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 現行契約の監査

現行 Backend の Balloon type は次の7種類である。

- `speech`
- `thought`
- `narration`
- `shout`
- `whisper`
- `sfx`
- `caption`

PR #67 の schema 案は `sfx` と `caption` を含まず、現行 Domain、
request validator、DB constraint、Repository normalization と一致しない。
そのまま接続すると効果音またはキャプションを含む正常応答が500になるため、
共有schemaは7種類すべてを受理する。Webの型定義も同じunionへ補正するが、
実行時payloadは変更しない。

## 必要条件

1. auth、rate limit、UUID request param、request body validationを変更しない。
2. personal / organization capability判定とServiceへ渡すscopeを変更しない。
3. 既存のsnake_case field、wrapper、201 / 200 / 204 statusを維持する。
4. 単一応答と `{ balloons: [...] }` 応答で同じitem schemaを使用する。
5. `sfx` と `caption` を含む現行の全 Balloon typeを受理する。
6. 不正な位置サイズ、font size、enum、型を200/201で返さない。
7. 検証失敗時はpayloadやZod詳細を公開せず、既存の安定した
   `CONFIGURATION_ERROR`を返す。

## 影響レイヤー

- Route: 成功payloadの返却直前に共通schema検証を追加する。
- Shared contract: Balloon item / list schemaを追加する。
- Web: `BalloonRecord.balloon_type` の型をBackendの既存7種類へ合わせる。
- Service / Repository / Domain / Migration / Worker / Infrastructure / Mobile /
  Ops: 変更しない。
- 永続化、外部API、job、credit: 変更しない。

## 互換性と運用影響

成功時は検証前と同じobjectを返すため、field、値、status、処理順は変わらない。
Zod検証は1件または1配列の同期処理だけで、DBや外部通信を増やさない。実際に
schema違反の内部値が発生した場合だけ、壊れた成功payloadの代わりに500となる。

Position は既存inputと自動配置が保証する正のwidth / heightを検証する一方、
過去データ互換のためx/y、tail、font size、panel order、z-indexにはPR #67と
同等の最小構造制約を使い、request側の全上限を出力へ新規強制しない。

## セキュリティ

- 既存auth、rate limit、organization capabilityを維持する。
- schema検証へrequest値を使わない。
- payload、発話内容、Zod issueをerror messageやログへ追加しない。
- ownership query、SQL、storage key、provider IDには触れない。

## テスト方針

先に以下の失敗テストを追加する。

1. 共通schemaが通常、`sfx`、`caption`を受理し、不正値を拒否する。
2. 4つの成功応答endpointがschema違反Service値を200/201で返さない。
3. 現行成功payloadがschemaを通り、fieldとstatusを維持する。
4. 既存の401、422、organization capability、204テストを維持する。

対象テスト後にVitest / Bun全体、DB migration / invariant、Backend build、
Web lint / build、Playwright smokeを実行する。

## Sol / Terra

変更は1 resourceのRoute、共有schema、Web型、限定テストに閉じる。利用可能な
`skills/lyra-sol-terra-orchestration` が現行mainに存在せず、ユーザーから
sub-agent委譲の指定もないため、Sol単独で設計・実装・レビューする。
