# セキュリティ修正の設計・検証記録

## 設計（実装前）

ユーザーの防御目的の実装依頼に基づき、監査SA-01〜05と依存ライブラリを対処する。根拠はUnified Spec §§4–9、検証は§10。既存作品・画像・クレジット、無料編集、通常/Googleログイン、カラー/白黒生成、旧クライアントのデータ契約を保護する。

元checkoutは未コミット変更を持つため変更せず、監査した統合commit `8f4cf087`の専用worktree/`codex/security-hardening-20261008`で実装する。公開PRへはセキュリティcommitだけを公開済み候補へ移植して検証し、未公開の統合差分を混ぜない。本番反映・main merge・store公開は今回の実装とは別の受入工程である。

- **決済:** 検証済みStripe eventをPaymentIntent/Chargeと既存付与へ結び、決済単位の累積状態で二重回収・順序逆転を防ぐ。成功返金/確定lostだけ回収し、open/pendingは保留。個人/組織ごとに残高・ledger・不足記録を同一transactionで更新する。ユーザーの選択は残額回収、不足記録、有料生成のみ保留。作品/画像と無料編集は維持する。部分返金は整数creditの切上げ比例計算とし、月次subscription枠を別周期から回収しない。
- **退会:** JWT署名等の既存検証を維持し、同じ本人の実認証時刻を短時間で検証してからserviceへ渡す。refresh/画面チェックのみで通さない。Mobileの再認証で既存session/draftを置換せず、失敗/キャンセルで退会を開始しない。旧body/responseと既存業務blockerを維持する。Webの既存認証・編集を保護し、新規の退会画面は追加しない。
- **画像:** MIME/拡張子に加え、実画像のmagicとサイズをdecoder実行前に検証する。正規PNG/JPEG/WebPと内部SVG描画を維持し、sharp/native依存を更新する。
- **入口・運用:** 検証originのCloudFront経路を認証し、未検証IPヘッダーのbucket変更を拒否する。Stripe正規通知の経路を維持する。AWS資格情報の安全な移行と長期監査は設定・手順として具体化し、既存キーを突然削除したり本番へ無検証で適用しない。
- **依存:** backend/Web/Mobile/開発ツールの所在を区別して対象advisoryの修正版へ更新する。非公開inventoryを監査APIへ送らず、公開OSV dumpをlocal照合する。major更新による機能変更は最小化し、互換性を検証する。

Solが課金設計・実装と最終独立レビュー、Terraが両clientの保留表示・Mobile再認証、親が認証guard・画像・共有契約・運用設定・依存/統合を担当する。一人が一つのファイルを所有し、共有ファイルは親が編集する。

先に失敗テストを確認し、返金の重複/部分/順不同/不足/個人組織分離、古い/欠落/別本人の再認証拒否とキャンセル時のdraft保持、画像偽装拒否と正規形式、偽装IP拒否とStripe経路を検証する。DB migration/invariants・全Vitest/Bun・backend build・Web lint/build/Playwright・Mobile contract/type/lint/tests/exportを必要なrelease gateとして確認する。実資産の削除・実返金・有料生成を検証に用いない。

## 実装・検証結果

決済調整はmigration049で決済単位・provider object単位の状態と不足分を保存する。新規Stripe決済には付与量と月次有効期限を記録し、既存の単発購入は検証済みCheckoutから照合する。旧subscriptionの付与量・周期が確証できない場合は耐久的な保留を記録し、Webhookを未処理のまま再試行させる。現在のプランから過去の付与量を推測して回収しない。個人/組織のpaid generationをserver側で拒否し、無料編集・保存・閲覧・exportを維持する。新しい残高項目は`X-Lyra-Credit-Recovery: 1`を送るclientだけに返し、旧clientのstrict schemaを壊さない。

退会POSTは署名検証済みCognito identityの同本人・auth_time（直近300秒、未来clock skew60秒まで）を確認する。Mobileは一時的な新ID tokenで`/api/me`を照合し、同じuser.idだけ退会POSTする。別本人・失敗・キャンセルでは既存session/編集内容を置換しない。Cognitoの実ログイン動作は実環境・実機で追加確認する。

既知の個人refund/dispute保留・不足creditがある間は、削除開始・匿名化・外部削除の前に再確認して退会を保留する。返金処理と削除transactionは同じuser rowのlockで直列化し、古いclientへ新しいblocker unionを流さず`ACCOUNT_CREDIT_RECOVERY_PENDING`の安定409を返す。Mobileには返金確認と閲覧・編集の継続をja/enで案内する。組織の保留は個人の退会を妨げず、個人の保留解消後は既存手続きを再開できる。

この対策の対象はDBに到達した既知の決済調整である。退会完了後に初めて成立した返金や、別identityの新規登録へ債務を継承する仕組みはない。恒久的なemail同一視や新たな個人情報の保持は追加していない。退会開始後に新しい保留が生じた場合、通常ログイン・購入による自己解決はできないため、保持された決済記録を運用担当が照合し、正規Webhook/決済調整で保留を解消してからrecovery workerを再開する。

画像処理入口はPNG/JPEG/WebP magic、実bytes20MiBまで、必要なdecoder40M pixelsを確認し、Sharpを0.35.5へ更新した。未検証originのIPヘッダーはpublic rate-limit quotaを変えられない。正規Stripe署名検証は維持する。

公開OSV dumpのlocal照合で、更新後の3 lockfileはMobileの2件を残す。`node-forge@1.4.0`（GHSA-86w9-cpqp-85rv、Expo update/code-signing certificate/CLI依存）と`braces@3.0.3`（GHSA-vfj7-8cjw-p6xm、Metro glob依存）は確認時の最新stableにも修正版がない。LyraのAPI入力から当該メソッドへの経路は確認できないが、Expo証明書・CI/ビルドの入力を信頼できる管理者/設定に限定する。ゼロ脆弱性の保証ではない。稼働中のimageは今回の変更を含まず、本番inventoryの12件を「解消済み」と数えない。

公開用branchは公開済み候補 `6c0c9681` を基準とし、未公開の機能差分を含めない。API、生成worker、退会workerは起動時に049のreceiptと実DBのcolumn/default/check/FK/indexを確認する。receiptだけ存在する、またはCHECKを弱めたDBでも起動を拒否する。049は新規migrationであり、適用済みmigrationを変更しない。

旧subscriptionの照合には `scripts/backfillStripeSubscriptionRecovery.ts` を追加した。既定はread-only dry-runで、確認した過去の付与量と期限を対象のinvoice/payment/PaymentIntent/Chargeにだけ結ぶ。並行適用と再実行で重複recoveryを作らず、別決済との衝突はrollbackする。残高・ledger・保留状態・Stripe処理済みmarkerをこのツールで変更しない。

移植後に発生した既存テストの問題も検証条件を保って修正した。隔離schemaのtable存在確認をschema-qualifiedにし、共有public schemaを誤参照しない。全画像templateの検証はtemplateごとのtestに分け、検証するtemplate・枠・pixelのassertionを省かず、単一testの5秒制限へ多数の画像処理を詰め込まない。

### 公開PRの最終検証

- Backend Vitest: 349 files / 2,620 tests PASS。PostgreSQL 18.3の隔離schemaで認可・返金・退会競合・旧DB互換性を含めて実行。
- Bun 1.4.2: 同じDB付き全349 files / 2,620 tests PASS。`bun install --frozen-lockfile --ignore-scripts`もPASS。旧1.3.14のasync matcher/DB停止は診断し、安定版1.4.2で既存テストのまま解消した。ユーザーのglobal runtimeは変更していない。
- Backend buildとAPI inventory（150 endpoints）PASS。空の専用DBへ全migration（1–046、049）適用、66 data invariantsと起動guard PASS。049の欠落・CHECK改変を拒否する実DB検証もPASS。
- Web lint/build PASS。Playwright全17 scenarios PASS（保留表示と無料編集・旧応答を含む）。追加の保留scenario単独もPASS。
- Mobile typecheck/generated contract/lint/Expo dependency check PASS、Expo Doctor 20/20 PASS。全183 files / 933 tests PASSに加え、最終追加の退会保留案内は対象9 tests PASS。最終Android/iOS exportともPASS。
- `cfn-lint`と差分チェックPASS。公開OSV dumpのlocal照合: candidateの3 lockfilesは修正版未提供の2 advisoryのみ、parse errors 0、semver境界5 checks PASS。稼働imageの12 advisoryは反映前の別inventoryとして残る。

実際のCognito再認証（native/Google・managed/classic UI）と実機Mobile smoke、stagingのStripe test-mode通知、AWS通知の受信、production/storeの受入は未実施。今回のPASSは本番反映済みやゼロリスクを意味しない。環境識別子・内部監査inventoryを含む監査原本は公開PRへ含めない。

## 反映時の手順と受入条件

1. stagingでDB snapshot/復元を確認し、既存release gateに従ってmigration049を先に適用する。新binaryの起動は回収table/column/check/FK/indexとreceiptを検証し、049がないDBへの起動を拒否する。ユーザー残高・作品・画像の変更前後を比較する。本番移行と旧binaryへのrollback中は旧binaryが新しい返金guardを実施しないため、有料生成/決済通知を無監視で戻さない。
2. Stripe通知先で`charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`を購読する。test modeで個人/法人、部分/全額、pending→failed、open→won/lost、同通知の再送、不足→新購入を確認する。invoice/Checkout通知も継続する。
3. `stripe_unresolved_payment_adjustments`が発生した旧subscriptionは、対象payment record/invoiceと実際のledgerから付与creditと期限を照合する。現在のプランやWebhookの任意metadataから推定しない。以下のコマンドをまずdry-runで実行し、対象と照合値の確認後だけ同じ引数へ`--apply`を追加する。ツールが同じtransactionで対象rowをlockし、未設定の`payment_records`付与metadataと対応recoveryを設定した後に元Stripe eventを正規Webhook経路へ再送する。手作業でhold解除、ledger回収、processed marker追加をしない。通常Webhookの累積回収が完了したときだけunresolvedが解決する。

   ```text
   node --import tsx scripts/backfillStripeSubscriptionRecovery.ts --unresolved-id <UUID> --credits <確認済み付与数> --expires-at <timezone付きISO日時>
   ```
4. [audit-foundation.json](../ops/security/audit-foundation.json)は未適用。管理eventを保存するmulti-region trailは一つだけ作成する。既存trail/GuardDutyの重複と費用を確認し、primary regionでtrailを作成、追加regionは`CreateAuditTrail=false`とする。GuardDuty既存regionでは`CreateGuardDutyDetector=false`。root loginは`us-east-1`, `us-east-2`, `us-west-2`でも記録されるため、Tokyoに加えてこれらのregionのalert ruleとSNS購読を用意する。各regionのtopicを購読・確認後、合成eventのpattern照合と管理者による実通知/Trail log deliveryを確認してから有効と判定する。365日保存/S3 versioning・log integrity validationを利用する。SNSのEventBridge service policyには非対応のConditionを追加しない。
5. AWS root長期keyはアプリ修正では無効化されない。IAM Identity Center管理者または限定AssumeRoleへCLIを移し、ECS task role/CI OIDCを用いて長期keyを不要にする。`sts get-caller-identity`がroot以外のassumed roleであること、主要なread-only操作とdeploy toolingの動作、root console/MFAの回復手段を確認する。CloudTrailのkey利用を確認した上で、明示承認後に当該keyをまず無効化し、動作確認後に削除する。移行前にkeyを消さない。秘密値をreport/logへ出さない。
6. staging ALBはCloudFront managed prefix list +secret origin headerに絞る。既存本番境界を保持し、prefix-list ruleのquota/portとinternal health-check経路を事前確認する。staging公開ドメイン経由のhealth/auth/Stripeが動作し、ALB直アクセスが拒否されることを確認する。

CloudFormationはlocal `cfn-lint`で検証する。AWS送信による`validate-template`は自動承認審査に拒否され、未実施。テンプレート保存はAWS監査設定の稼働を意味しない。

参考: [AWS root best practices](https://docs.aws.amazon.com/us_en/IAM/latest/UserGuide/root-user-best-practices.html)、[root ConsoleLogin region](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-aws-console-sign-in-events.html)、[EventBridge SNS resource policy](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-use-resource-based.html)。
