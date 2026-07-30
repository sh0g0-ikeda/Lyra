# Mobile billing balance response contract design

## Purpose and scope

`GET /api/billing/balance` に、保存済みの個人向け Stripe 購読から更新日と
期間終了時解約フラグを返す。共通 API schema でレスポンスを検証し、Mobile
クライアントがクレジット有効期限を購読更新日として誤表示しない契約を作る。

この変更では Mobile アプリ、Apple / Google Store 課金、checkout / portal
レスポンス、DB schema、既存の購読書き込み処理を変更しない。Store 購読との
統合は migration 029 と検証処理を含む PR-C の責任とする。

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` §3: Route / Service / Repository の責務境界
- `docs/Lyra_Unified_Spec_v4.md` §7: personal credit と billing の分離
- `docs/Lyra_Unified_Spec_v4.md` §8: 出力の schema validation
- `docs/mobile-release-task-list-2026-07-30.md` PR-A:
  `/api/billing/balance` の subscription summary と追加 wire field の監査

## Design

### Input and authorization

既存どおり認証済みユーザーの `GET /api/billing/balance` だけを対象とする。
リクエスト入力や認可範囲は変更しない。

### Service and persistence

- `BillingService` は既存の
  `BillingRepository.findLatestActiveSubscriptionForUser(userId)` を呼び、
  provider ID を含まない個人購読 summary に変換する。
- personal scope は既存 Repository の
  `user_id = $1 AND organization_id IS NULL` 条件を再利用する。
- `user.planCode === 'free'` の場合は購読照会を省略し、summary を `null` と
  する。無料ユーザーが大半の場合に `subscriptions` の追加読取を発生させない。
- 有料ユーザーのクレジット残高と購読 summary は並列に取得する。外部 Stripe
  API は呼ばない。
- Stripe 未設定時の既存 stub は summary を `null` とし、従来の残高表示を
  壊さない。

### Response

既存レスポンスを維持し、次の2項目を追加する。

- `current_period_end: string | null`
- `cancel_at_period_end: boolean`

購読 summary がない場合はそれぞれ `null` と `false` にする。
`monthly_expires_at` はクレジットの有効期限のままで、購読更新日には使わない。
レスポンス全体は `packages/api-contract` の Zod schema で検証してから返す。

追加項目だけの後方互換な変更であり、既存 Web クライアントは未知の項目を
無視する。既存項目の名前、型、意味、HTTP status は変えない。

## Security and operational impact

- 認証、rate limit、personal tenancy 条件は維持する。
- Stripe customer / subscription ID は Route に渡さず、レスポンスにも出さない。
- SQL は既存の parameter binding を再利用する。
- DB 書き込み、クレジット計算、外部 API 呼び出しは増えない。
- 無料ユーザーのDB負荷は現状と同じ。有料ユーザーだけ1読取が増えるが、
  クレジット取得と並列化するため応答時間は原則として両読取の遅い側になる。
- subscriptions 読取が失敗した場合は不正確な解約状態を成功応答で返さず、
  既存エラーハンドリングに従って失敗させる。

## Tests

先に次の失敗テストを追加する。

1. 共通 schema が新しい完全なレスポンスを受理し、欠落・不正値を拒否する。
2. Service が保存済み購読を provider API なしで安全な summary に変換する。
3. Route がクレジット期限と購読期間終了日を分離して返す。
4. 無料ユーザーでは購読照会を行わず、`null` / `false` を返す。

対象テスト後に backend Vitest / Bun、build、Web lint / build、Playwright smoke
を実行する。DB schema を変えないため migration / invariant は回帰確認として
実行する。

## Sol / Terra

変更は Route、既存 Service、共通 schema と限定テストに閉じる小規模な契約変更
である。利用可能な `skills/lyra-sol-terra-orchestration` が現行 main に存在せず、
ユーザーからsub-agent委譲の指定もないため、Sol単独で設計・実装・レビューする。
