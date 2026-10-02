# Googleログイン — Cognitoを残す

## 1. 方針と利用体験

Cognitoを撤去せず、GoogleをCognitoの外部IdPとして追加する。アプリの「Googleで続ける」から既存Authorization Code + PKCEへ進み、通常はLyra独自のメール確認を省ける。初回のアカウント選択/Google同意が必要なことがあるため「必ず1タップ完了」とは保証しない。

アプリAPIに送るのは従来どおりCognito発行token。Google access/id tokenをそのまま既存APIの認証として受け付けない。既存メール/パスワードのログイン・パスワード再設定は残す。

## 2. 外部設定とcallback

- Google OAuth client、同意画面/公開状態、許可scopeを設定。秘密値は管理環境/Secrets Manager等へ、文書・Git・アプリbundleに入れない。
- **通常ログイン用**Google OAuth clientのredirect URIは `https://{既存Cognitoドメイン}/oauth2/idpresponse`。
- Cognito user poolへGoogle IdP、email/email_verified等のattribute mapping、対応app clientのsupported identity providerを追加。
- アプリ側redirect/logoutは既存 `lyra-mobile://...` 等の登録済みURIを維持。Google用redirectとは別物。Webを提供している場合も既存の正確なcallback allowlistへ追加する。
- Mobileは既存PKCE/state検証を使い、必要ならauthorization parameter `identity_provider=Google` を追加。code交換後のCognito JWT issuer/audience/token_use/expiry等の検証を維持。
- custom domainやCognitoメール文面変更はこの機能の前提ではない。現行Mobile production configはamazoncognitoドメイン制限を持つので、無関係に変更しない。

根拠: [AWS Google等のsocial IdP設定](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-social-idp.html)。実環境のpool/client ID、callback、必須属性・groupをread-onlyで確認してから適用する。

## 3. 最重要: 同じメールの既存ユーザー

現在の `UserProvisioningService` はsubject未一致・email一致の場合に `linkSupabaseIdByEmail` でDBの認証subjectを書き換える。Googleをそのまま追加すると、native/socialで別subjectが発行される状況で意図しない付け替えやアカウント分裂が起こり得る。**email一致だけで統合する実装は禁止**。

守るもの: 既存内部user ID、Cognito nativeの安定sub、作品・組織membership・残高・台帳・購入主体、初回特典の一度限り付与。legacy column名 `supabase_id` は今回renameしない。

### 最小の安全な連携フロー

1. 新規Googleユーザー: 検証済みCognito subjectに基づいて通常provisioning。内部user作成と初回特典は既存の一意制約/transactionで一度だけ。
2. 既存の同メールアカウントがあるがGoogle未連携: Cognito Pre sign-upの外部IdPイベントでnativeアカウントとの衝突を検出し、**新federated profileを作る前に拒否**する。小さい専用triggerであり、同メールを自動linkする処理ではない。通常native登録/既存のtrigger契約を変えず、必要最小IAMとtimeoutを設定。安全な `ACCOUNT_LINK_REQUIRED` 相当の案内から、既存の方法でログインして連携へ進める。APIでもemail衝突時のsubject上書きを拒否し、防御を二重化する。公開のemail検索APIは作らない。
3. 既存アカウントに再認証しているユーザーが「Googleを連携」を実行。serverが内部user/Cognito native subject、OAuth state/nonce、期限を束縛した一回性challengeを作る。
4. **連携専用Google OAuth client**を同じ管理プロジェクトに別登録し、redirectを固定したLyra HTTPS callbackへ向ける。通常Cognitoログインのcodeを横取り/二重交換しない。連携専用callbackでcodeを交換し、issuer/audience（連携専用client）/expiry/nonce/Google subject/email_verified等を検証。リクエストbodyのemail/provider subjectを信用しない。別人のGoogleを紐付けられないよう、今回の最小版は検証済みemail一致も要求する（ただしemail一致だけでは不十分）。
5. 両方の所有を確認した後、server権限で `AdminLinkProviderForUser` を実行してGoogle subjectを既存native userへ連携。challenge消費は原子的で、replay・多重callback・別sessionは拒否。次回はCognitoから元の安定subjectを受け取れることを統合テストする。
6. 別のLyra userへすでに紐付くGoogle subjectは衝突として止める。自動的なuser統合、DB行/購入/残高の移動・削除をしない。Cognito federated profileが既に作成されリンクできないケースは専用の運用復旧手順と個別承認へ分離する。

[AWS identity linking](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-federation-consolidate-users.html)、[AdminLinkProviderForUser API](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminLinkProviderForUser.html)に従い、通常は初回federated profile作成前にlinkする。Google subjectをCognito_Subjectとして扱う正確なAPI引数は実装時に公式仕様を再確認する。

challengeの一回性と複数APIインスタンスを両立するため、既存のTTL/nonce保存機構が使えれば再利用する。なければ `oauth_link_challenges` の小さい追加table（user_id/provider/nonce_hash/expires_at/consumed_at/creation session binding）を追加。PKCE verifier等の短命交換情報が必要なら暗号化保管し期限で除去。生tokenやGoogle client secretは保存しない。プロセスメモリだけのreplay防止や署名ticketだけの無状態消費判定は禁止。

API案は認証・最近の再認証が必要な `POST /auth/identity-links/google/start` と固定callback。browser callback自体にはMobileのBearer headerが届かないため、推測困難なstateから開始sessionへ束縛したchallengeを検証する。callbackは明示的な公開例外としてrate limitし、任意redirectを許さない。完了後はtokenをURLに載せずアプリが認証済み照会で結果を確認し、Cognitoログインし直す。独自の一般ログイン基盤に拡張しない。通常ログインはCognito、連携challengeだけ別責務にする。

現行middlewareはprovisioningへsub/emailだけを渡している。client申告providerによる判別を追加して逃がさない。方針は、通常認証からemailによるsubject付替えを撤去し、既存の正当な移行が必要な分だけ管理者向けoffline移行へ隔離する。事前に未移行ユーザーの有無をread-only監査し、残る場合は移行対応を先に整えてから切り替える。すでにsubjectで一致する既存ログインは維持する。監査用途でproviderを記録するなら検証済みCognito claimsだけを用いる。

Pre sign-upで衝突時に拒否できる根拠は [AWS Pre sign-up trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-sign-up.html)。autoVerifyEmailで既存aliasを別ユーザーへ移す挙動は使用しない。連携専用OAuthのstate/nonce/token検証は [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)に準拠する。既存poolにtriggerがあれば置換せず必要な分岐だけ統合する。

## 4. Apple配布とデータ共有

iOSで第三者social loginを追加する場合、App Review Guidelines 4.8の同等ログイン要件を確認する。一般にはSign in with Apple等が必要になるため、**iOS公開ゲート**にする。Apple追加はユーザー要求の確定済み機能として黙って実装せず、適用する例外の有無または必要な追加範囲を記録して判断を求める。Android/Webや他のバックエンド作業を止める理由にはしない。[Apple審査ガイドライン 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services)

provider追加に応じたプライバシー説明・アカウント削除/連携解除の扱いを確認する。唯一の認証手段を解除してログイン不能にしない。Google連携によってマーケティング同意等を自動変更しない。

## 5. 必須検証

新規Google/既存native/同メール衝突/明示連携/同時初回ログイン/他ユーザーへの連携済み/メール変更/未検証email/誤audience/失効/nonce再送/cancel/通信断、Cognito group・法人権限、初回bonus二重付与なし、旧ログイン継続を確認する。

Googleボタンだけ成功しても完了ではない。元の内部user ID・作品・残高・組織・購入復元が同一であることを確認する。feature flag OFFとIdP非表示を主なrollbackにし、既存の連携済みユーザーを消さない。公開後の切戻しではGoogle-onlyユーザーのログイン手段を失わせない手順を用意する。
