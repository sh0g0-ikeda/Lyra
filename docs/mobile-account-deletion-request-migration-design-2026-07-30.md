# Account deletion request migration 027 設計

## 目的と範囲

account deletionの外部処理チェックポイントを永続化する加算的tableを先行追加する。API、Service、Repository、Cognito、Stripe、S3処理はこのPRでは追加せず、既存本番挙動を変えない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Authentication / Security / Data and migrations / Test and verification
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-B / MOB-AUTH-005

## 影響レイヤーとインターフェース

- Migration: `account_deletion_requests`とpending indexを追加する。
- Ops invariant: status、retry count、processing claim pairを検査する。
- Route / Service / Repository / Domain / Infrastructure / Worker / Web / Mobile: 変更しない。
- tableを参照するproduction codeはまだ存在しないため、migration適用後もAPI動作は不変。

## 永続化契約

- `user_id`を主キーとし、同一利用者の削除要求を1 flightに限定する。
- subscription取消、identity disable/delete、asset lifecycle、data anonymize、完了を個別checkpointとして保持する。
- `processing_token`と`processing_started_at`は同時にnullまたは同時に非nullとする。
- statusは`blocked` / `processing` / `pending_external_action` / `completed`に限定する。
- retry countは0以上、blocker codeは最大16件とする。
- user rowは匿名化後も外部キーanchorとして残す設計のため`ON DELETE RESTRICT`とする。

## 依存とrollout

- feature側AccountDeletionRepositoryはmigration 029の`mobile_store_purchases`を参照するため、このPRでは移植しない。
- account deletion API/ServiceはStore購入台帳の統合後に追加し、有効なStripe/Store subscriptionを両方blockerへ含める。
- migrationは加算的で既存tableを書き換えない。rollbackが必要な場合も、参照code導入前はtable/indexの削除だけで戻せる。

## セキュリティ

- identity IDや外部失敗詳細をAPI/ログへ公開するcodeは追加しない。
- provider credential、purchase token、raw errorを保存しない。
- 将来のRepositoryは本人user IDだけでscopeし、organization dataを削除対象へ含めない。

## TDDと検証

1. migrationのFK、status、retry、claim pair、pending indexを読む契約テストを先に追加し、missing fileで失敗を確認する。
2. deployment invariantへ3検査を要求するテストを先に追加し、missing invariantで失敗を確認する。
3. migrationとinvariantだけを実装する。
4. focused test、全Vitest/Bun、migration、invariant、backend/Web build、Playwright smokeを実行する。

## Terra委譲

委譲なし。上位指示によりsub-agentは使用せず、migration 029へのcode依存を混入させないことをSolローカルチェックリストで確認する。
