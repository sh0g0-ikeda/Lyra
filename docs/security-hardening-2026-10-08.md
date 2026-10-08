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

起動schema guardはPG16/17のNOT NULLをcolumn属性で、PG18以降をcolumn属性とNOT NULL制約のvalidated/hashで確認する。不正/PG16未満は拒否し、CHECK/FK/PK/unique/indexは全versionで必須とする。

旧subscriptionの照合には `scripts/backfillStripeSubscriptionRecovery.ts` を追加した。既定はread-only dry-runで、確認した過去の付与量と期限を対象のinvoice/payment/PaymentIntent/Chargeにだけ結ぶ。並行適用と再実行で重複recoveryを作らず、別決済との衝突はrollbackする。残高・ledger・保留状態・Stripe処理済みmarkerをこのツールで変更しない。

移植後に発生した既存テストの問題も検証条件を保って修正した。隔離schemaのtable存在確認をschema-qualifiedにし、共有public schemaを誤参照しない。全画像templateの検証はtemplateごとのtestに分け、検証するtemplate・枠・pixelのassertionを省かず、単一testの5秒制限へ多数の画像処理を詰め込まない。

### 公開PRの最終検証

- Backend Vitest: 349 files / 2,626 tests PASS（公開PR最終CI）。PostgreSQL 18.3の隔離schemaで認可・返金・退会競合・旧DB互換性を含めて実行。
- Bun 1.4.2: 同じDB付き全349 files / 2,626 tests PASS（最終CIは`--isolate`使用）。`bun install --frozen-lockfile --ignore-scripts`もPASS。旧1.3.14のasync matcher/DB停止は診断し、安定版1.4.2で既存テストのまま解消した。ユーザーのglobal runtimeは変更していない。
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
   # source checkout
   node --import tsx scripts/backfillStripeSubscriptionRecovery.ts --unresolved-id <UUID> --credits <確認済み付与数> --expires-at <timezone付きISO日時>
   # production image / ECS task（同じdry-run、確認後だけ--apply）
   bun dist/scripts/backfillStripeSubscriptionRecovery.js --unresolved-id <UUID> --credits <確認済み付与数> --expires-at <timezone付きISO日時>
   ```
4. [audit-foundation.json](../ops/security/audit-foundation.json)は未適用。管理eventを保存するmulti-region trailは一つだけ作成する。既存trail/GuardDutyの重複と費用を確認し、primary regionでtrailを作成、追加regionは`CreateAuditTrail=false`とする。GuardDuty既存regionでは`CreateGuardDutyDetector=false`。root loginは`us-east-1`, `us-east-2`, `us-west-2`でも記録されるため、Tokyoに加えてこれらのregionのalert ruleとSNS購読を用意する。各regionのtopicを購読・確認後、合成eventのpattern照合と管理者による実通知/Trail log deliveryを確認してから有効と判定する。365日保存/S3 versioning・log integrity validationを利用する。SNSのEventBridge service policyには非対応のConditionを追加しない。
5. AWS root長期keyはアプリ修正では無効化されない。IAM Identity Center管理者または限定AssumeRoleへCLIを移し、ECS task role/CI OIDCを用いて長期keyを不要にする。`sts get-caller-identity`がroot以外のassumed roleであること、主要なread-only操作とdeploy toolingの動作、root console/MFAの回復手段を確認する。CloudTrailのkey利用を確認した上で、明示承認後に当該keyをまず無効化し、動作確認後に削除する。移行前にkeyを消さない。秘密値をreport/logへ出さない。
6. staging ALBはCloudFront managed prefix list +secret origin headerに絞る。既存本番境界を保持し、prefix-list ruleのquota/portとinternal health-check経路を事前確認する。staging公開ドメイン経由のhealth/auth/Stripeが動作し、ALB直アクセスが拒否されることを確認する。

CloudFormationはlocal `cfn-lint`で検証する。AWS送信による`validate-template`は自動承認審査に拒否され、未実施。テンプレート保存はAWS監査設定の稼働を意味しない。

参考: [AWS root best practices](https://docs.aws.amazon.com/us_en/IAM/latest/UserGuide/root-user-best-practices.html)、[root ConsoleLogin region](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-aws-console-sign-in-events.html)、[EventBridge SNS resource policy](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-use-resource-based.html)。

## 未公開の統合機能と合わせた検証

8f4統合worktreeでもsecurity-only変更を反映し、既存のstate-reference lifecycle/continuation/Google連携の実装を保持した。全Vitest（PostgreSQL18.3）454 files / 3,951 tests PASS、backend build PASS。Mobile全188 files / 1,065 tests PASS後、最終の再認証不一致メッセージは対象12 testsとtype/contracts/lint、Android/iOS exportで追加確認した。Webの統合側Playwrightは79 PASS / 5 SKIP（公開用の全17 scenariosとは別集合）。

統合候補9494dc6では、Bun 1.4.2の`bun test --isolate`を使用し、Vitestと同じファイル単位の隔離を適用した。既存のmodule mock共有とBun未対応matcherを修正し、検証するassertionを維持した。全456 files / 3,961 testsがBunとVitestの双方でPASS（Bun: 0 FAIL、16,350 expects）。backend buildとWeb lint/build、Playwright 79 PASS / 5 SKIP、Mobile contracts/type/lintとAndroid/iOS exportもPASS。CIもBun 1.4.2と`--isolate`を固定した。公開PRのCI run37757092651はverify/mobile-verifyともSUCCESS。未公開のops・worker・harnessを公開PRへ混ぜていない。

公開PR: https://github.com/sh0g0-ikeda/Lyra/pull/222 （公開済み候補向けDraft。本番反映なし）。元checkoutの既存32 dirty entriesは変更せず保持した。

## 既設検証環境への反映設計（2026-10-08、実施中）

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

CloudFront default certificateではTLSv1 minimumが固定されるため、設定値だけを変えてTLS1.2限定達成とは扱わない。viewerのTLS1.2限定には別途custom alias+ACM証明書が必要。本番設定は変更していない。
### 検証環境への反映と実ブラウザ受入結果

- stagingの048/049 migration taskはexit0。移行直前の元047 catalog/14 table hash/active job=0、移行後のfull catalog attestation・同じ14 table hash・金融aggregate・76/88 release checksを再確認してからAPIを1台へ戻した。現在のAPI16・generation16・export16・deletion16・Google expiry6・migration17は同じcandidate digest。API target healthy、CloudFrontのhealthz/readyz=200、未認証api/me=401。
- 入口変更の途中ではorigin直接続と偽装headerにdefault403を確認し、正式rule/SG cleanup後はCloudFront prefix以外の直接続をネットワークで遮断した。最終状態は上記の入口制限記録と実測JSONで確認した。
- 実Chromeで既存Googleログインを継続し、4作品一覧、話の編集/手動保存/再読込復帰を確認。専用の保存確認話に付けた確認文は元の文章へ戻して再保存した。既存の1024×1536漫画画像を2か所で確認した。
- 既存作品や画像を上書きせず、検証作品内へ「セキュリティ受入 2026-10-08」キャラクターを追加。通常GPT Image 2の全身プレビューを1回だけ実行し、queued→completed、1024×1536の画像表示と永続化を確認。検証creditは6→5、ledgerは15→16 row・総額6→5となり、クレジット消費は想定の1crだけ（Stripe payment_recordsは0のまま）。残高の手動補填や生成の再試行は行っていない。
- generation workerはこの受入時だけ1台にし、完了後CloudFormationで0台へ復帰。最終のAPIは1/1/0、3 workerは0/0/0、runtime stack UPDATE_COMPLETE。active generation/export/deletion=0、deletion_blocked=0。browser後の76/88 release checksもviolationsなし。新規entity/reference_set各1行を除き、作品4・章4・話8・ページ65・コマ/枠257などの件数は維持。
- 既存ページ1枚を「画像」で保存し、UIの完了通知と実ダウンロードファイルを確認。ブラウザのdownload event observerはタイムアウトしたが、同操作でDownloadsにPNG 2,920,531bytesが保存され、native decoderで1024×1536/RGBとして正常復号できた。受入は画面の通知だけで判断していない。
- 生成結果の証拠:元checkoutのignored `.tmp/security-20261008/preview-completed.jpg`。元checkoutの32 dirty entriesには変更を加えていない。公開PR222/CI成功と、今回実配備した未公開統合候補9494dc6は区別している。

今回の受入は署名検証・返金重複/順不同・有料保留・再認証失敗/キャンセルの自動回帰に加え、実stagingの保存・画像・生成・downloadを確認した範囲である。stagingにはStripe test-mode secretがなく、EPISODE_EXPORT_ENABLED/ACCOUNT_DELETION_ENABLED/MOBILE_STORE_BILLING_ENABLEDも元からfalseのため値を維持した。Stripe実通知、nativeアプリのGoogle/native再認証と退会、現在配布中binaryの実機smokeは完了扱いにしない。source/公開CIのSKIPをPASSへ数えず、production/storeの差替承認も得ていない。

### 保持している復元・検証資源

作業前snapshot `lyra-staging-security-20261008-before`と停止後snapshot `lyra-staging-security-20261008-quiesced`を保持した。今回作った専用restore DB `lyra-staging-security-rehearsal`は049の追加検証/復元手順確認用に保持中で、継続費用が発生する。既存の別rehearsal DBを削除・変更しない。追加検証と入口変更を完了した後、必要な復元点とactive-useを確認して、自分が作った一時資源だけを整理する。元のDB/作品/S3画像やDockerの保存済み修復backupを削除しない。
配備したARM64 manifest（4f349f2f…8ae7）のECR basic image scanは2026-10-08 18:44:53 JSTにCOMPLETE、findingSeverityCountsは空（検出0）と確認した。lockfileのOSV照合とは対象が異なり、Mobile build依存の未修正2 advisoryを解消扱いにしない。最終の画面証拠はignoredの".tmp/security-20261008/acceptance-completed.jpg"にも保存。local DB検証用に今回起動したloopback15433の専用PostgreSQL helperは終了し、dataを保持した。
