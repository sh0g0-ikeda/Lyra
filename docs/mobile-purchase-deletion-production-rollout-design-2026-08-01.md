# Mobile購入・アカウント削除・本番反映 設計

## 目的と範囲

初回Mobileリリースで未完了のAI単独作業を、現在表示される4タブを壊さずに完了する。
追加するユーザー向け機能は、個人workspaceの購入UIとアカウント削除UIだけとする。
既にmainへ入っている購入・削除Backend契約を利用し、新しいBackend、DB field、migration、
organization管理UI、Balloon / Frame UI、Push、Exportは追加しない。

実装は購入UI、アカウント削除UI、本番preflightの独立したPRへ分ける。旧PR #67は
参照に限定し、現在のmainへ必要な契約だけを移植する。各PRは最新mainから開始し、
単体テスト、Mobile gate、required CIを通してから次へ進む。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` section 4: 認証済みユーザー本人だけが削除を要求する。
- section 5: 削除はblocker、acknowledgement、外部処理をfail closedで扱う。
- section 7: Mobile課金はserver verifier、allowlist、credential、明示flagが揃うまで無効。
- section 8: raw purchase proof、token、provider error、secretを画面・ログへ出さない。
- section 10: release gateと本番のmigration / readiness / queue / log確認を満たす。

## 影響レイヤー

- Mobile: Account画面、購入adapter、API client、表示文言、component / domain test。
- Ops: migration前read-only preflight、invariant、rollback checkpoint、段階デプロイ手順。
- Backend / Repository / Domain / Worker / Migration / Web: 既存契約を変更しない。

## インターフェースと状態遷移

### 購入

1. MobileはOSに対応するserver catalogを読み、native storeから同じproduct IDを取得する。
2. server catalogとnative storeの両方に存在する商品だけ購入可能にする。
3. 表示価格はnative storeの`displayPrice`だけを使い、金額をコードへ固定しない。
4. native purchase proofはメモリ上でserver verificationへ渡し、画面・ログ・永続storageへ残さない。
5. server verificationが成功したtransactionだけnative側でfinishする。
6. pending、cancel、通信失敗、検証失敗、未反映商品を別状態として表示する。
7. restoreもserverで冪等検証した後だけtransactionをfinishし、session残高を再取得する。
8. organization workspaceでは購入componentもcatalog requestも生成しない。

### アカウント削除

1. `GET /api/account/deletion`で影響、owner / job blocker、subscription、store billing、assetを表示する。
2. 必要なacknowledgementと大文字`DELETE`の入力が揃うまでPOSTを送らない。
3. blockerはMobileで推測せず、POST時のserver再判定を正とする。
4. `blocked`、`in_progress`、`pending_external_action`、`completed`を区別する。
5. 処理中・失敗は再取得または再試行可能とし、二重送信を抑止する。
6. `completed`後はCognitoの外部logout成功に依存せず、auth token、React Query cache、
   private image memory cacheを消してsign-in画面へ戻す。

## セキュリティと後方互換性

- personal purchase APIへ`organization_id`を送らない。
- account deletion requestへuser ID、identity ID、organization ID、storage keyを送らない。
- Zodで全responseを検証し、不正な応答は`INVALID_API_RESPONSE`として保存・表示しない。
- raw StoreKit JWS / Google purchase tokenを例外message、state、console、test snapshotへ残さない。
- subscription購入がserver bindingで禁止されている場合はnative request前に拒否する。
- feature flag OFFまたはroute未mountの404は安全な利用不可表示に変換し、既存4タブへ影響させない。
- 既存session、Page / Panel、job、credit、Web API、DB schemaの形は変更しない。

## テスト方針

コード変更は先に失敗テストを追加し、対象機能が未実装で失敗することを確認する。

- 購入component: loading / error / empty / unavailable / personal-only / display price。
- native adapter: iOS / Android request、pending / cancel / network / verification failure、
  verify-before-finish、restore、duplicate event、proof非露出。
- API client: catalog / binding / Apple / Google / restoreのpath、body、schema、timeout。
- 削除component: preview、全blocker、acknowledgement、二重送信抑止、全status、retry、completed。
- session: completed後のlocal-only credential / cache cleanup。
- 最終gate: Mobile Vitest / typecheck / lint / contract check / Android・iOS export、
  Backend Vitest / Bun / build、PostgreSQL migration / invariant、Web lint / build、Playwright。

## Terra委譲

- 購入UIとnative adapterの旧PR参照範囲をread-onlyで監査する。
- アカウント削除UIと現在のBackend response形をread-onlyで監査する。
- migration 027–039と本番preflightの不足をread-onlyで監査する。
- 設計、採否、統合、secret、本番操作、最終安全判断はSolが担当する。

## 本番反映の停止条件

- migration適用前のschema / data invariantが不明または違反あり。
- API / Worker image digestがrelease commitと一致しない。
- feature flagの初期OFFを確認できない。
- queue / DLQに処理中または滞留がある。
- migration、readiness、既存生成、credit ledger、refundのいずれかが失敗する。
- application error、認可逸脱、raw proof / secretのログ出力を検出する。

本番反映は、復元時点と旧Task Definitionを記録してからmigrationをone-offで実行し、
invariant成功後に同一digestのWorkerとAPIを順次更新する。購入・削除flagは初回反映では
OFFのまま維持し、外部設定と実機E2Eが完了した後に別変更として有効化する。
