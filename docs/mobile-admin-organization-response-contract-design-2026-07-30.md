# Admin organization response contract 接続設計

## 目的と範囲

運用管理者向けの法人契約更新・credit手動付与の既存JSON応答を共有API contractへ接続し、契約外Service値を成功データとして返さない。

対象:

- organization contract update
- organization credit grant

管理者認可、契約更新Service、credit transaction / ledger、DB、一般Mobile UIは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` sections 3–8
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: admin organization contract summaryのstrict schemaを追加し、credit balance schemaを再利用する。
- Route: 現行mapperでwireへ変換後、HTTP送信直前に共有contractを検証する。
- Service / Repository / Domain / Infrastructure / DB / Web / Mobile: 変更しない。
- request、200/201 status、認証、管理者メールallowlist、監査、credit付与を維持する。

## 互換境界

- 契約更新は既存の部分的なorganization summaryだけを返す。
- billing emailとmonthly expiryのnullを維持する。
- creditは0以上の整数、既存enterprise plan/status enumを受理する。
- operator-only endpointのままとし、Mobile consumer APIへ分類しない。

## セキュリティ

- 既存認証、rate limit、管理者メールallowlist判定を変更しない。
- itemとwrapperをstrict schemaで検証する。
- Stripe customer/subscription ID、ledger詳細、内部organization fieldを公開しない。
- 契約不一致は既存の汎用ConfigurationErrorとしてfail closedする。

## TDDと検証

1. null・0値の受理と内部field・未知enum・負数拒否を先にテストする。
2. 対象2 endpointが契約外Service値を500にするテストを先に追加し、失敗を確認する。
3. contractとRoute guardだけを実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。上位指示によりsub-agentは使用せず、operator-only認可とcredit transactionを変更しないことをSolローカルチェックリストで確認する。
