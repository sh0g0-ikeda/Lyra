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

先に失敗テストを確認し、返金の重複/部分/順不同/不足/個人組織分離、古い/欠落/別本人の再認証拒否とキャンセル時のdraft保持、画像偽装拒否と正規形式、偽装IP拒否とStripe経路を検証する。DB migration/invariants・全Vitest/Bun・backend build・Web lint/build/Playwright・Mobile contract/type/lint/tests/exportを必要なrelease gateとして確認する。実資産の削除と本番環境での実返金・有料生成は検証に用いない。後続のstaging生成とStripe Test決済は専用受入として別記する。

## 実装・検証結果

決済調整はmigration049で決済単位・provider object単位の状態と不足分を保存する。新規Stripe決済には付与量と月次有効期限を記録し、既存の単発購入は検証済みCheckoutから照合する。旧subscriptionの付与量・周期が確証できない場合は耐久的な保留を記録し、Webhookを未処理のまま再試行させる。現在のプランから過去の付与量を推測して回収しない。個人/組織のpaid generationをserver側で拒否し、無料編集・保存・閲覧・exportを維持する。新しい残高項目は`X-Lyra-Credit-Recovery: 1`を送るclientだけに返し、旧clientのstrict schemaを壊さない。

退会POSTは署名検証済みCognito identityの同本人・auth_time（直近300秒、未来clock skew60秒まで）を確認する。Mobileは一時的な新ID tokenで`/api/me`を照合し、同じuser.idだけ退会POSTする。別本人・失敗・キャンセルでは既存session/編集内容を置換しない。Cognitoの実ログイン動作は実環境・実機で追加確認する。

既知の個人refund/dispute保留・不足creditがある間は、削除開始・匿名化・外部削除の前に再確認して退会を保留する。返金処理と削除transactionは同じuser rowのlockで直列化し、古いclientへ新しいblocker unionを流さず`ACCOUNT_CREDIT_RECOVERY_PENDING`の安定409を返す。Mobileには返金確認と閲覧・編集の継続をja/enで案内する。組織の保留は個人の退会を妨げず、個人の保留解消後は既存手続きを再開できる。

この対策の対象はDBに到達した既知の決済調整である。退会完了後に初めて成立した返金や、別identityの新規登録へ債務を継承する仕組みはない。恒久的なemail同一視や新たな個人情報の保持は追加していない。退会開始後に新しい保留が生じた場合、通常ログイン・購入による自己解決はできないため、保持された決済記録を運用担当が照合し、正規Webhook/決済調整で保留を解消してからrecovery workerを再開する。

画像処理入口はPNG/JPEG/WebP magic、実bytes20MiBまで、必要なdecoder40M pixelsを確認し、Sharpを0.35.5へ更新した。未検証originのIPヘッダーはpublic rate-limit quotaを変えられない。正規Stripe署名検証は維持する。

公開OSV dumpのlocal照合で、更新後の3 lockfileはMobileの2件を残す。`node-forge@1.4.0`（GHSA-86w9-cpqp-85rv、Expo update/code-signing certificate/CLI依存）と`braces@3.0.3`（GHSA-vfj7-8cjw-p6xm、Metro glob依存）は確認時の最新stableにも修正版がない。LyraのAPI入力から当該メソッドへの経路は確認できないが、Expo証明書・CI/ビルドの入力を信頼できる管理者/設定に限定する。ゼロ脆弱性の保証ではない。本番稼働中のimageは今回の変更を含まず、本番inventoryの12件を「解消済み」と数えない。

公開用branchは公開済み候補 `6c0c9681` を基準とし、未公開の機能差分を含めない。API、生成worker、退会workerは起動時に049のreceiptと実DBのcolumn/default/check/FK/indexを確認する。receiptだけ存在する、またはCHECKを弱めたDBでも起動を拒否する。049は新規migrationであり、適用済みmigrationを変更しない。

起動schema guardはPG16/17のNOT NULLをcolumn属性で、PG18以降をcolumn属性とNOT NULL制約のvalidated/hashで確認する。不正/PG16未満は拒否し、CHECK/FK/PK/unique/indexは全versionで必須とする。

旧subscriptionの照合には `scripts/backfillStripeSubscriptionRecovery.ts` を追加した。既定はread-only dry-runで、確認した過去の付与量と期限を対象のinvoice/payment/PaymentIntent/Chargeにだけ結ぶ。並行適用と再実行で重複recoveryを作らず、別決済との衝突はrollbackする。残高・ledger・保留状態・Stripe処理済みmarkerをこのツールで変更しない。

移植後に発生した既存テストの問題も検証条件を保って修正した。隔離schemaのtable存在確認をschema-qualifiedにし、共有public schemaを誤参照しない。全画像templateの検証はtemplateごとのtestに分け、検証するtemplate・枠・pixelのassertionを省かず、単一testの5秒制限へ多数の画像処理を詰め込まない。

### 公開PRの最終検証

公開コード検証HEAD `490b1a49b93edc41a33dc67643669bc6e8392dde` の [CI run 37772582322](https://github.com/sh0g0-ikeda/Lyra/actions/runs/37772582322) はverify/mobile-verifyともSUCCESS。以下はこのHEADの結果であり、未公開のstaging統合候補とは分けて扱う。後続の公開commitは監査記録だけの更新で、検証済みコードは変更していない。

資料更新後の公開HEAD `f6904a53f2343eb5bcac525658b1d9f41c02a6b9` でも [CI run 37777983122](https://github.com/sh0g0-ikeda/Lyra/actions/runs/37777983122) はverify/mobile-verifyともSUCCESS。Bun 350 files/2,629 tests、Playwright17、Mobile934 tests/Expo Doctor20/20を最新logで確認し、Vitest/DB regressions/migration/invariants/build/lint/両OS exportの全step成功も確認した。

- Backend Vitest: 350 files / 2,629 tests PASS。PostgreSQL 18.3のDB regressionsは24 files / 210 tests PASS。隔離schemaで認可・返金・退会競合・旧DB互換性を含めて実行。
- Bun 1.4.2: 同じDB付き全350 files / 2,629 tests PASS（最終CIは`--isolate`使用）。`bun install --frozen-lockfile --ignore-scripts`もPASS。旧1.3.14のasync matcher/DB停止は診断し、安定版1.4.2で既存テストのまま解消した。ユーザーのglobal runtimeは変更していない。
- Backend buildとAPI inventory（150 endpoints）PASS。空の専用DBへ全migration（1–046、049）適用、66 data invariantsと起動guard PASS。049の欠落・CHECK改変を拒否する実DB検証もPASS。
- Web lint/build PASS。Playwright全17 scenarios PASS（保留表示と無料編集・旧応答を含む）。追加の保留scenario単独もPASS。
- Mobile typecheck/generated contract/lint/Expo dependency check PASS、Expo Doctor 20/20 PASS。全183 files / 934 tests PASS。最終Android/iOS exportともPASS。
- `cfn-lint`と差分チェックPASS。監査templateのroot read管理event/監査bucket改変検出は先に失敗を確認し、公開版Vitest/Bun各3 tests、統合版のTLS/DNSを含む各6 tests PASS。lint error0、既存warning6。公開OSV dumpのlocal照合: candidateの3 lockfilesは修正版未提供の2 advisoryのみ、parse errors 0、semver境界5 checks PASS。本番稼働imageの12 advisoryは反映前の別inventoryとして残る。

実際の退会用Cognito再認証（native/Google・managed/classic UI）と実機Mobile smoke、AWS監査通知の受信、production/storeの受入は未実施。stagingのStripe Test実通知は下記の購入・累積返金・再送で確認した範囲に限定する。今回のPASSは本番反映済みやゼロリスクを意味しない。環境識別子・内部監査inventoryを含む監査原本は公開PRへ含めない。

## 反映時の手順と受入条件

1. stagingでDB snapshot/復元を確認し、既存release gateに従ってmigration049を先に適用する。新binaryの起動は回収table/column/check/FK/indexとreceiptを検証し、049がないDBへの起動を拒否する。ユーザー残高・作品・画像の変更前後を比較する。本番移行と旧binaryへのrollback中は旧binaryが新しい返金guardを実施しないため、有料生成/決済通知を無監視で戻さない。
2. Stripe通知先で`charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`を購読する。test modeで個人/法人、部分/全額、pending→failed、open→won/lost、同通知の再送、不足→新購入を確認する。invoice/Checkout通知も継続する。
3. `stripe_unresolved_payment_adjustments`が発生した旧subscriptionは、対象payment record/invoiceと実際のledgerから付与creditと期限を照合する。現在のプランやWebhookの任意metadataから推定しない。以下のコマンドをまずdry-runで実行し、対象と照合値の確認後だけ同じ引数へ`--apply`を追加する。ツールが同じtransactionで対象rowをlockし、未設定の`payment_records`付与metadataと対応recoveryを設定した後に元Stripe eventを正規Webhook経路へ再送する。手作業でhold解除、ledger回収、processed marker追加をしない。通常Webhookの累積回収が完了したときだけunresolvedが解決する。

   ```text
   # source checkout
   node --import tsx scripts/backfillStripeSubscriptionRecovery.ts --unresolved-id <UUID> --credits <確認済み付与数> --expires-at <timezone付きISO日時>
   # production image / ECS task（同じdry-run、確認後だけ--apply）
   bun dist/scripts/backfillStripeSubscriptionRecovery.js --unresolved-id <UUID> --credits <確認済み付与数> --expires-at <timezone付きISO日時>
   ```
4. [audit-foundation.json](../ops/security/audit-foundation.json)は未適用。管理eventを保存するmulti-region trailは一つだけ作成する。既存trail/GuardDutyの重複と費用を確認し、primary regionでtrailを作成、追加regionは`CreateAuditTrail=false`とする。GuardDuty既存regionでは`CreateGuardDutyDetector=false`。root loginは`us-east-1`, `us-east-2`, `us-west-2`でも記録されるため、Tokyoに加えてこれらのregionのalert ruleとSNS購読を用意する。各regionのtopicを購読・確認後、合成eventのpattern照合と管理者による実通知/Trail log deliveryを確認してから有効と判定する。365日保存/S3 versioning・log integrity validationを利用する。SNSのEventBridge service policyには非対応のConditionを追加しない。
5. AWS root長期keyはアプリ修正では無効化されない。IAM Identity Center管理者または限定AssumeRoleへCLIを移し、ECS task role/CI OIDCを用いて長期keyを不要にする。`sts get-caller-identity`がroot以外のassumed roleであること、主要なread-only操作とdeploy toolingの動作、root console/MFAの回復手段を確認する。CloudTrailのkey利用を確認した上で、明示承認後に当該keyをまず無効化し、動作確認後に削除する。移行前にkeyを消さない。秘密値をreport/logへ出さない。
6. staging ALBのCloudFront managed prefix list +secret origin header制限は反映・実測済み（下記）。本番への適用時も既存境界、quota/port、internal health-check経路を確認し、公開ドメイン経由のhealth/auth/StripeとALB直アクセス拒否を再受入する。

CloudFormationはlocal `cfn-lint`で検証する。AWS送信による`validate-template`は自動承認審査に拒否され、未実施。テンプレート保存はAWS監査設定の稼働を意味しない。

参考: [AWS root best practices](https://docs.aws.amazon.com/us_en/IAM/latest/UserGuide/root-user-best-practices.html)、[root ConsoleLogin region](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-aws-console-sign-in-events.html)、[EventBridge SNS resource policy](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-use-resource-based.html)。

## 未公開の統合機能と合わせた検証

8f4統合worktreeでもsecurity-only変更を反映し、既存のstate-reference lifecycle/continuation/Google連携の実装を保持した。全Vitest（PostgreSQL18.3）454 files / 3,951 tests PASS、backend build PASS。Mobile全188 files / 1,065 tests PASS後、最終の再認証不一致メッセージは対象12 testsとtype/contracts/lint、Android/iOS exportで追加確認した。Webの統合側Playwrightは79 PASS / 5 SKIP（公開用の全17 scenariosとは別集合）。

統合候補9494dc6では、Bun 1.4.2の`bun test --isolate`を使用し、Vitestと同じファイル単位の隔離を適用した。既存のmodule mock共有とBun未対応matcherを修正し、検証するassertionを維持した。全456 files / 3,961 testsがBunとVitestの双方でPASS（Bun: 0 FAIL、16,350 expects）。backend buildとWeb lint/build、Playwright 79 PASS / 5 SKIP、Mobile contracts/type/lintとAndroid/iOS exportもPASS。CIもBun 1.4.2と`--isolate`を固定した。公開PRの旧HEADのCI run37757092651もSUCCESSだったが、現在の公開HEADは上記run37772582322で判定する。未公開のops・worker・harnessを公開PRへ混ぜていない。

公開PR: https://github.com/sh0g0-ikeda/Lyra/pull/222 （公開済み候補向けDraft。本番反映なし）。元checkoutの既存32 dirty entriesは変更せず保持した。

## 既設検証環境への反映設計（2026-10-08）

ユーザーは既設AWS検証環境と改修中frontend/backendの編集・反映・実ブラウザ確認を依頼した。現ストア版が利用する既存APIは、将来のbackend差替後も維持する。アプリの環境切替機能の新設は今回の目的ではない。本番サービスの更新やストア公開は含めない。

反映候補は現stagingの03bcを祖先に持つ統合版391fを基準とし、runtime/テスト修正を含む9494dc6を配備する。公開PR222は古い公開基点へのbackportであり、そのartifactをstagingへそのまま置換しない。Bun/Vitestの同等な回帰、DB migration/invariant/runtime attestation、Web/Mobile build・lint・契約・export・browser gateを同じ候補で確認する。変更はテスト機構、Docker/runtime配備契約、実受入で見つかった必要なfrontend/backend差分に限定する。

AWSの現task/image/flags、DB履歴、queue/job、作品・画像・creditの基準値と復元点を確認する。専用migration taskの適用後に全worker/APIを同一digestへ更新する。未処理jobを把握せずworkerを増やさず、実生成は専用テスト作品と最小件数に限定する。CloudFront経由の認証・API・画像・exportと正規provider通知を保ち、直接originと偽装IPを拒否する。readiness、worker完了、旧clientのheaderなしstrict契約、返金保留時の無料編集・閲覧・export、再認証を実環境で確認する。

旧clientに新しいoptional fieldを無条件追加しない。quote/state等の新受付flagは既存値と固有受入を確認して扱い、旧生成・編集・billingの機能を消さない。回収row作成後に旧imageへ戻して保留を無視させない。停止・再送・refundの冪等性を確認し、DB downやmigration receipt削除は行わない。SolがBun互換テスト、Terraがfrontend gate、親がruntime/配備/実ブラウザの統合を担当する。

### 同一候補で完了した配備前検証

- ARM64 imageをBun 1.4.2の固定digestから作成。non-root UID65532、read-only filesystem、networkなしのnative smokeでSharp0.35.5のPNG生成/復号を確認。candidate index digestは`sha256:bb1103f31e5181d9baaf21499b8a9623fb1f02b85f247466c8e4012b26d0b576`、revision labelは9494dc6。
- CodeBuildはARM Small/Mediumともアカウントのqueue gateで拒否され、quota変更・別資格情報による回避・サポート送信は行っていない。正規local Dockerで作成した同じARM64 artifactをstaging ECRへpushし、digestを再取得した。
- staging DBはcanonical001–047の物理catalog/履歴を確認。専用snapshotから専用DBへ復元し、8 catalog部分と作品・画像参照・credit等14 tableの件数/hashが一致した。既存の別rehearsal DBは変更していない。
- 復元先に048→049を適用し、full runtime attestationとcapability guard PASS。14 tableの件数/hashは移行前後で同一。個人/組織credit、15 ledger rowと総額、user row、payment rowの比較も同一で、新しいrecovery/adjustment/unresolved tableは空。不足分や過去付与量を推測して作っていない。
- 復元先のrelease checkはbackend-only 76 checks、new-mobile 88 checks、violationsなし。remoteStoragePolicyVerifiedはfalseのままなので、実S3/IAMの受入までPASSと扱わない。
- release checkのmobile-client-id指定はweb image deliveryとの分離だけを検証するため、Cognito許可への包含も別に確認した。検証用native client 6sarocqfaahcpl7cs5o0o9ja3cが許可され、web clientとは分離、token_use=id、AUTO_RUN_MIGRATIONS=false。公開中ストアbinaryの全Client ID/token種別の棚卸しと実機旧版smokeは別の本番差替gateとして残る。

### 停止・移行の順序

runtimeのContainerImageはAPI・生成・export・退会・migration・Google expiryの6 task definitionで共通である。最初のCloudFormation更新はimageとDesiredApiCount=0だけを変更し、全worker数0と全既存flag/Google scheduleを保持した。Google scheduleのtask revisionへの参照更新を含む既存権限target更新もchange-setで確認し、新しい権限やroleを追加しない。

API/workerが0/0になった後の最終snapshot `lyra-staging-security-20261008-quiesced`はavailable。stage移行taskは、元047 catalog、14 tableの件数/hash、active job=0を再確認してから048/049を適用する。048成功・049失敗では書き込み停止を保ち、同じ候補で再実行するか、候補の新規書き込み前に確認済みsnapshotを復元する。候補で新しい書き込みが生じた後は049対応imageによるforward fixを使い、旧03bc imageへ戻さない。

### 入口制限の反映と確認

ユーザーの明示承認後、role lyra-staging-20261003-foundation-cfn-r2へ、既存stage listenerだけのCreateRuleと同listener配下のAddTags/RemoveTags/ModifyRule/DeleteRuleを追加した。適用した限定policyは ops/staging/ingress-cfn-role-policy.json に保存し、AWS get-role-policyとの一致を確認した。本番への権限追加、trust policyやroot keyの変更は行っていない。

foundation stackは2026-10-08 19:42 JSTにUPDATE_COMPLETEとなり、正式なCloudFormation管理のpriority1 ruleが完成した。秘密headerの一致と同じstage targetへのforward、default403を値を出力せず確認した後、今回作成したpriority100の暫定ruleだけをARN/tagで確認して撤去した。live ALB SGのinboundは443/tcp + CloudFront managed prefix pl-58a04531の1本だけで、IPv4/IPv6 CIDRや別SGからの許可はない。

暫定rule撤去後もCloudFrontのroot/healthz/readyz=200、未認証api/me=401、API target healthy。origin直HTTPSと無効header＋偽装x-forwarded-forの直接続は、最終SG制限後には7秒で接続timeout（HTTP応答なし、curl exit28）となった。実Chromeの再読込後もGoogle認証済みで4作品・保存済み文章・残高5を確認し、既存漫画画像2か所の1024×1536復号/表示が正常。API 1/1/0、生成/export/退会worker 0/0/0、runtime UPDATE_COMPLETEを保持した。証跡は .tmp/stage-ingress-final-evidence.json、画面は元checkoutのignored .tmp/security-20261008/ingress-completed.png。

CloudFront default certificateではTLSv1 minimumが固定されるため、設定値だけを変えてTLS1.2限定達成とは扱わなかった。後続の承認済みcustom alias+ACM反映でviewer TLS1.2以上を実測した（下記）。本番設定は変更していない。
### 検証環境への反映と実ブラウザ受入結果

- stagingの048/049 migration taskはexit0。移行直前の元047 catalog/14 table hash/active job=0、移行後のfull catalog attestation・同じ14 table hash・金融aggregate・76/88 release checksを再確認してからAPIを1台へ戻した。現在のAPI16・generation16・export16・deletion16・Google expiry6・migration17は同じcandidate digest。API target healthy、CloudFrontのhealthz/readyz=200、未認証api/me=401。
- 入口変更の途中ではorigin直接続と偽装headerにdefault403を確認し、正式rule/SG cleanup後はCloudFront prefix以外の直接続をネットワークで遮断した。最終状態は上記の入口制限記録と実測JSONで確認した。
- 実Chromeで既存Googleログインを継続し、4作品一覧、話の編集/手動保存/再読込復帰を確認。専用の保存確認話に付けた確認文は元の文章へ戻して再保存した。既存の1024×1536漫画画像を2か所で確認した。
- 既存作品や画像を上書きせず、検証作品内へ「セキュリティ受入 2026-10-08」キャラクターを追加。通常GPT Image 2の全身プレビューを1回だけ実行し、queued→completed、1024×1536の画像表示と永続化を確認。検証creditは6→5、ledgerは15→16 row・総額6→5となり、クレジット消費は想定の1crだけ（Stripe payment_recordsは0のまま）。残高の手動補填や生成の再試行は行っていない。
- generation workerはこの受入時だけ1台にし、完了後CloudFormationで0台へ復帰。最終のAPIは1/1/0、3 workerは0/0/0、runtime stack UPDATE_COMPLETE。active generation/export/deletion=0、deletion_blocked=0。browser後の76/88 release checksもviolationsなし。新規entity/reference_set各1行を除き、作品4・章4・話8・ページ65・コマ/枠257などの件数は維持。
- 既存ページ1枚を「画像」で保存し、UIの完了通知と実ダウンロードファイルを確認。ブラウザのdownload event observerはタイムアウトしたが、同操作でDownloadsにPNG 2,920,531bytesが保存され、native decoderで1024×1536/RGBとして正常復号できた。受入は画面の通知だけで判断していない。
- 生成結果の証拠:元checkoutのignored `.tmp/security-20261008/preview-completed.jpg`。元checkoutの32 dirty entriesには変更を加えていない。公開PR222/CI成功と、今回実配備した未公開統合候補9494dc6は区別している。

上記はStripe Test設定前の保存・画像・生成・download受入である。後続で承認済みStripe Test設定と実通知を追加した（下記）。EPISODE_EXPORT_ENABLED/ACCOUNT_DELETION_ENABLED/MOBILE_STORE_BILLING_ENABLEDは元からfalseのため維持した。nativeアプリのGoogle/native再認証と退会、現在配布中binaryの実機smokeは完了扱いにしない。source/公開CIのSKIPをPASSへ数えず、production/storeの差替承認も得ていない。

### Viewer TLS制限の反映と実測

ユーザーが許可した既存DNS zone `Z06854141YIQEBHNYPPXP` の `staging-20261003.lyra-editor.com` A/AAAA CREATE/UPSERT/DELETEだけをfoundation roleへ追加した。本番名・他zone・CNAME・name/type/action欠落・stageと他名の混在はIAM simulationで拒否し、8ケースを確認した。us-east-1 ACMの同stage名だけの証明書 `f7b44e51-d28e-4fd0-97b7-ef7ebf71f205` はISSUED。

foundationのchange set `security-viewer-tls-20261008-r1` は、実差分3件を確認後に反映してUPDATE_COMPLETE。CloudFront `E2BL30PE3M45EZ` はDeployed、SNI証明書とTLSv1.2_2021を使用する。OpenSSLによる実接続でprimary CloudFront名とstage aliasの両方がTLS1.0/1.1をserver protocol versionで拒否し、TLS1.2の証明書検証に成功した。証跡は元checkoutのignored `.tmp/security-20261008/viewer-tls-matrix.json` と `viewer-dns-simulation-results.json`。

Web/native Cognito clientのcallback/logout設定は前後同一。Google認証の実ブラウザ受入は従来のprimary CloudFront URLで行った。alias単独の対話ログインは今回の受入範囲に含めない。

### Stripe Test設定・実通知・累積返金の受入

ユーザーが許可したLyra Japan Test account `acct_1TGUv3RoF6paLir7` だけに、primary CloudFront `/api/webhooks/stripe` のTest endpoint `we_1UOFuKRoF6paLir7MNvRW3Zo` を作成した。Stripe SDK22.6.2と同じAPI version `2026-08-26.dahlia`、既存8イベントとrefund/dispute7イベントの計15種を購読し、現在enabled/Testを再取得した。API versionを変更できない旧Test draft endpointはdisabledで保持し、live endpointは変更していない。

Standard/Premium月額と3種の追加creditのTest priceをruntimeと一致させた。`lyra-staging-20261003-runtime` へTest API key・署名key・5 price ID・success/cancel/portal return URLの10項目だけをmergeし、既存71項目を全件比較して保持した。AWSPENDINGをread backしてからversion `d8f24ff8-1956-487c-912f-d0f89bdb08f4` をAWSCURRENTへ昇格し、旧versionを復元点として残した。key値はGit・reportへ含めず、転送一時ファイルは権限をcurrent user/SYSTEM/Administratorsだけに限定した。APIだけを同じtask16/imageで再配備し、新deploymentはCOMPLETED。worker台数・既存flagは変更していない。

実Chromeの既存Googleログインで、Stripe公開Test cardを用い次を確認した。実資金の移動や既存購入の返金は行っていない。

- 10credit/220円のTest Checkoutで残高不足cardが拒否され、キャンセル後も残高5。success return URLを直接開いても残高5で、browser URLだけでは付与されない。
- 新しいTest Checkoutがpaidとなり、正規通知と画面の更新表示を経て5→15。決済対象は表示済みTest session/同一customer・actor/owned priceだけを照合した。
- 同じ220円決済へ110円の成功部分返金を2回行い、残高15→10→5。累積返金110→220に対応し、各回収は5credit。1回目の処理を同idempotency keyで再実行しても新しい返金は作られなかった。
- Stripe画面から同じ `refund.updated` を手動再送し、初回と再送がHTTP200/received=true。再送後の残高10は変わらず、最後の部分返金後は5。Webhook配信一覧で7 unique eventと1 resendの8試行すべてHTTP200を確認した。
- migration17のread-only ECS probeはSTOPPED/exit0、runtime schema/capability guard PASS。paymentはpaid220円・付与10・累積返金220・回収10・不足0。ledgerの回収はexactly2行（-5/-5）、processed markerは7 unique event、最終ledger19行/総額5で再送による追加回収なし。unresolved/pending adjustmentは0。
- 同probeで作品4・章4・話8・ページ65・コマ/枠257を保持し、backend-only/new-mobile release profileはok=true/violationsなし。最終Chromeも4作品と残高5を確認。既存作品の削除、credit手動補填、ledger手動修正は行っていない。
- Test default Customer Portal `bpc_1UOGN2RoF6paLir77me2q6tZ` をactiveとして保存し、Standard/Premiumのruntimeと同じ2価格だけをプラン変更に許可。解約と低額プランへの変更は期間終了時、上位変更は日割り・即時invoice。アプリの請求管理ボタン→hosted Test portal→Lyraへ戻る実操作と「請求情報を更新しました」を確認した。no-code portal login linkは有効化していない。

証跡は元checkoutのignored `.tmp/security-20261008/stripe-stage-billing-proof.json`、`stripe-paid-acceptance.json`、`stripe-refund-half.json`/`stripe-refund-rest.json`。画面は `stripe-webhook-final.png`、`stripe-portal-completed.png`、`stripe-lyra-final.png` に保存した。Test portalの短命session URLの一部が操作出力に含まれたため、以後の画面抽出ではリンク先全行を除外した。Test API key/署名keyを表示したものではなく、当該sessionで実資金は扱っていない。

最終のportal API照合ではproductsを明示展開し、同じ2価格・at_period_end解約・always_invoice・低額変更のdecreasing_item_amount条件を確認した。Secrets Managerもexact ARN/Name/AWSCURRENT versionと全項目一致・既存71項目保持を再確認してから、今回作った秘密転送5ファイルと暗号化key/public PEM/browser対象記録の3ファイルだけを非再帰で削除した。親directoryと各対象のreparseを拒否し、全対象の消失と空directoryの撤去を確認した。秘密を含まないaudit receiptは保持し、`.tmp/security-20261008/stripe-final-settings-proof.json` にcleanup済みの結果を保存した。

最終のCloudFront healthz/readyzは200、未認証api/meは401、署名なし/偽造署名のStripe POSTは422で拒否。API 1/1/0、generation/export/deletionは0/0/0、各deployment COMPLETEDを再取得した。

実Testで確認したのは個人の単発購入、決済拒否、累積部分返金、同通知再送、portalへの往復である。購読15種類すべての実通知を確認したわけではない。法人、subscription invoice/proration、scheduleによる期日ダウングレード、pending→failed、dispute won/lost、不足credit→新購入は自動回帰と区別し、実provider受入を残す。

### 未完了の重大リスクと差替前のgate

- AWS CLI callerは依然rootの長期key。Identity Centerは稼働しているが、この時点で利用可能な管理permission set/割当がない。移行先・回復手段を確認してから権限を限定した管理者へ移す必要があり、root keyの無効化/削除や広い管理権限追加は今回行っていない。
- audit templateのroot read管理event検出と監査bucket改変検出はTDDとlocal lintで検証したが、CloudTrail/GuardDuty/SNSを稼働・受信確認した状態ではない。監査設定のdeploy先、通知受信先、重複/費用を確定して実deliveryを確認するまで未完了。
- 現ストアbinaryの全Cognito client/token種別の棚卸し、旧版実機smoke、native/Googleの退会用再認証を残す。旧HTTP contract/strict schemaとopt-inは自動回帰・DB受入で維持したが、実機確認の代替にはしない。
- Mobile依存の修正版未提供2 advisory、退会完了後の新規返金や別identityへの債務継承の限界、上記Stripe実provider未検証系列を残す。本番環境の旧image/監査inventoryを解消済みとは扱わず、本番差替・main merge・store公開も行っていない。

今回のstaging反映・ブラウザ受入は完了した範囲を上記に記録した。root資格情報と監査運用が未解消のため、「重大なリスクがない」「本番差替可能」とは判定しない。

### 実機確認用staging APKの配布設計

ユーザーは最新改修版を検証環境につないだAndroid APKをEAS buildページで受け取り、まずログイン・編集・表示を実機確認する。generation workerは0台を維持する。Unified SpecのVerification gateとLocal release compatibility preflightを根拠に、既に検証・配備した9494dc6とmobile/shared domainの差分がない9add620から、既存のstaging profile・Cognito client・callback・署名鍵を使用する。本番profile、ストア配信、本番backendは変更しない。

staging channelの実読取ではupdateGroupsが空だったため、既存runtimeVersion 0.1.18を維持する。配布直前にも空であることを再確認する。EAS configの実効値、ローカルarchive、build receipt、APKのpackage/scheme/API/auth設定・署名・SHA256を照合してから配布する。rootの内部資料・Git履歴・ops・秘密・ログをアップロードしないよう、一時的なroot .easignoreでmobile build入力だけを許可し、inspect archiveで除外を確認する。この変更はアップロード配線だけでアプリ動作を変えないため、失敗テスト追加は不要とする。既存のmobile回帰/型/lint/exportの証拠を参照し、APK実機の認証・保存は別の受入として残す。親がbuildと統合を担当し、Solが配布/OTA判断、Terraが読み取り専用の契約・証拠照合を担当する。

#### APK build・artifact検査結果

EAS build `8d787391-8b4b-4f94-8d57-b28af5621973` は2026-10-08 22:20:46 JSTにFINISHED。配布ページは https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/8d787391-8b4b-4f94-8d57-b28af5621973 。Android/internal/staging profile/channel、version/runtime 0.1.18、versionCode 1、source commit `9add620cdcd03986ce3fdf34a62104501cf003ef`、EAS fingerprint `d1c7e9273feacd1ae725f2b02574946942768eff` を実receiptで確認した。EAS上のExpo Doctorは20/20 PASS。

アップロード前のinspect archiveは213 files / 2,900,884 bytes（src197、assets4）。すべてsource対応pathとSHA256が一致し、必要入力欠落0、Git履歴・root docs/ops・秘密・ログ・reparse pointなし。manifest SHA256は `87025afd654d1f2d2aae7c906553d6e5677ba2be27d469139edba0481139ff01`。Solの独立read-only照合も一致した。Windowsのdirectory ignore判定をローカルinspectで修正した後だけuploadし、アップロード用の一時 `.easignore` はreceipt取得後に撤去した。最初の誤ったroot build commandが作った未使用eas.jsonと空のintent-to-add登録も今回所有分だけ除去し、元checkoutの32 dirty entriesを保持した。

取得したAPKは107,230,188 bytes、SHA256 `be0a1bcd7572939e7be7e81828b39d7f5da3cdfd008859d9275ab7e1e155a04f`。package `com.lyra.mobile.staging`、label `Lyra Mobile Staging`、scheme `lyra-mobile-staging`、stage app-link、runtime 0.1.18とstaging OTA headerを実manifest/resourceで確認した。APK Signature v2が有効で、既存staging certificate SHA256 `001efdc75467ab92e5372080e647d0aec61996a4fb0ecfa50b89e35095105c5f` と一致。ZIP CRC/16KB zip alignment、96 native librariesの全64bit LOAD segmentの16KB alignmentもPASS。初回のresource照合はaaptとaapt2の表示形式差で失敗したためaapt2で再抽出し、期待runtimeを変更せずPASSした。

Hermes bundleにはstage CloudFront API、stage Cognito domain/client、stage callback/logout、`X-Lyra-Credit-Recovery` opt-inが含まれる。bundle SHA256は `b1ae9a7c958e2ef18a0cb502798a2c243e62834305de44d57138668f69bf937f`。Solの独立bytecodeレビューでは、これらのstage API/auth値がbaseConfigへ実際に格納され、preview環境とstage Web editor URLが構成・検証されることを確認した（source config.ts 214–246に対応）。文字列の存在だけで接続先を判定していない。配布直前のchannel再取得でもstaging branchのupdateGroups=0。stage APIは1/1/0、generationは0/0/0、healthz/readyz=200、未認証api/me=401を再取得した。生成worker増台、本番更新、store提出、APKからの決済/生成操作は行っていない。

証跡は元checkoutのignored `.tmp/security-20261008/apk-archive-proof.json`、`apk-build-finished.json`、`apk-verification.json`、`apk-channel-final.json`、`apk-stage-service-final.json`。実機の上書きinstall、Cognito/Googleログインと戻り、既存作品/画像表示、編集保存・再読込はユーザー確認を残す。APKのartifact検査を実機受入や本番差替の合格に代えない。

#### 生成workerの自動起動設定と説明の訂正

APK配布時にdesired/running=0だけを見て「画像生成を完了できない」と説明したのは誤りだった。後続のAWS実読取で、generation serviceのApplication Auto Scaling targetはmin0/max1、dynamic scale-in/outとも停止なしと確認した。stage専用SQSのvisible messageが1以上になると、60秒/1 datapointの有効CloudWatch alarmからExactCapacity=1のpolicyを呼ぶ。scale-out cooldownは60秒。visible+inflight+delayedがすべて0の状態を60秒/3 datapointsで確認すると、別の有効alarmからExactCapacity=0へ戻す（scale-in cooldown180秒）。現在0台はidle時の状態であり、自動起動の無効化ではない。

直近のscaling historyには2026-10-06の1→0がSuccessfulとして残り、両alarmのActionsEnabled=true、scale-out alarm=OK/scale-in alarm=ALARMも再取得した。これらのscaling resourceはruntime CloudFormation stack内のresource一覧には含まれず、ECS desired count parameterだけでは存在を判定できない。生成要求がqueueへ正常受付されればworkerが起動して処理する設定で、起動待ち時間が生じる。今回この説明訂正のためにgeneration要求を作ったり、worker台数・alarm/policyを変更したりしていない。更新後imageによる0→1の自動起動を使った実機生成は、ブラウザでのmanual1台受入とは区別して未実施とする。alarm条件の証跡は元checkoutのignored `.tmp/security-20261008/generation-autoscaling-alarms.json`。

### 保持している復元・検証資源

作業前snapshot `lyra-staging-security-20261008-before`と停止後snapshot `lyra-staging-security-20261008-quiesced`を保持した。今回作った専用restore DB `lyra-staging-security-rehearsal`は049の追加検証/復元手順確認用に保持中で、継続費用が発生する。既存の別rehearsal DBを削除・変更しない。追加検証と入口変更を完了した後、必要な復元点とactive-useを確認して、自分が作った一時資源だけを整理する。元のDB/作品/S3画像やDockerの保存済み修復backupを削除しない。
配備したARM64 manifest（4f349f2f…8ae7）のECR basic image scanは2026-10-08 18:44:53 JSTにCOMPLETE、findingSeverityCountsは空（検出0）と確認した。lockfileのOSV照合とは対象が異なり、Mobile build依存の未修正2 advisoryを解消扱いにしない。最終の画面証拠はignoredの".tmp/security-20261008/acceptance-completed.jpg"にも保存。local DB検証用に今回起動したloopback15433の専用PostgreSQL helperは終了し、dataを保持した。
