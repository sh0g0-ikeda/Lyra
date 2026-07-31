# Mobile Entity reference 閲覧 slice 設計

## 目的と範囲

保存済み Entity を選択したとき、既存の確定済み reference set の状態、primary の有無、画像数、source、作成日時、画像を Mobile の Characters 画面で読み取り専用表示する。

この slice は将来の `import / generate / candidate preview / confirm / delete` に必要な画像表示基盤を先に安全化する。候補画像、画像選択、upload、生成ジョブ、確認、削除、Entity state、服装、Page 生成は含めない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` sections 3–6
- protected API は認証と personal ownership / active organization membership で scope する。
- production image delivery は authenticated export または短命 signed URL を使う。
- Mobile は既存 API contract を消費し、Route / Service / Repository / Worker の責任を移動しない。

## 影響レイヤー

- Mobile: Characters UI、query key、API client、認証付き画像表示、i18n、tests
- dependency: Expo SDK 57 と互換な `expo-image`
- 変更しない: Backend Route / Service / Repository、DB / migration、Worker、Web、shared API contract、credit、generation job

## インターフェースとデータ境界

- JSON は既存 `GET /api/entities/:id/reference-set` と生成済み `entityReferenceSetSchema` を使う。
- response の `entity_id` が選択 Entity と一致しなければ fail closed にする。
- 画像は HTTPS の optional `cdn_url` を先に試し、失敗または省略時は既存 `GET /api/entities/:id/reference/:ref_id/image` を Bearer header 付きで使う。
- protected source の entity ID、reference ID、`organization_id` は URL encode し、personal / organization を混同しない。
- 画像失敗は reference set 全体の正常データを隠さず、画像カード単位で安定したエラーと再試行を表示する。
- 読み取り専用のため mutation、永続化、generation job、credit の受け渡しは追加しない。

## セキュリティと可用性

- `cdn_url` は HTTPS だけを採用し、不正値や HTTP は使わない。
- Authorization header、signed URL、S3 key、raw server error を画面、ログ、query key、cache keyへ残さない。
- private image は signed URL と認証付きfallbackの両方で `expo-image` の memory cache のみに限定し、custom cache identity に session、workspace、Entity、reference、revision を含める。token と signed URL は identity に含めない。
- sign-out、remote logout、致命的token refresh失敗を含む全token-null遷移でquery cacheとmemory image cacheを消去する。
- protected source が失敗した場合だけ token refresh を single-flight で1回実行し、新しい token で1回だけ再試行する。無限 retry はしない。
- reference set の `200 + empty` は正常状態、404 / 403 / 5xx / network は empty に読み替えない。
- 現行 export contract は response byte 上限を公開していない。Mobile だけの後段判定では受信前の資源消費を防げないため、本 slice では FileSystem/data URI 化を行わず native image transport を使う。hard cap が必要なら別 Backend contract として設計する。

## TDD と検証

先に次の失敗テストを追加する。

1. API client: scope、schema、Entity mismatch、401 refresh、失敗応答。
2. source builder: HTTPS priority、URL encode、personal/org/session/revision cache 分離、token 非混入。
3. resilient image: signed URL failureからprotected source、bounded token refresh、新token再試行、安定error、identity切替。
4. Characters UI: 未選択、新規draft、empty、partial/ready、画像metadata、query error/retry、organization scope。
5. sign-out: private image memory cache を best effort で消去する。

対象Mobileテスト、typecheck、lint、dependency check、expo-doctor、Android/iOS exportを先に確認する。PR-ready時はBackend Vitest/Bun、PostgreSQL migration/invariant、Backend build、Web lint/build、Playwright smokeも実行し、Mobile以外の差分がないことを確認する。

## Terra 委譲

Terra は `origin/main` を基準に read-only 監査を担当し、既存endpoint/schema、PR #67の参考範囲、Expo SDK 57の画像source/cache、401、tenancy、MIME/size境界を確認した。設計、実装、統合判断、Backend非変更の最終確認は Sol が担当する。
