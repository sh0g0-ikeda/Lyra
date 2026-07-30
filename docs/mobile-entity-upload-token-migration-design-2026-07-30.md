# Entity reference upload token migration 031 design

## 目的と範囲

Mobile等の大きな画像をAPI bodyへbase64送信せず、将来S3へ直接uploadするためのsingle-use authorization recordとRepositoryを追加する。

対象はdomain型、migration 031、token Repository、deployment invariant、契約テストである。presigned URL、S3 read、画像解析、credit消費、Route、`src/app.ts`配線、Web / Mobile UIは接続しない。既存`POST /api/entities/import-image`のbase64経路は変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Input and output safety / Data and migrations
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-B / DB-300 migration 031

## 永続化契約

- opaque tokenそのものは保存せず、lowercase hex SHA-256 hashだけを保存する。
- tokenはuser、任意organization、任意entity、purpose、MIME、申告size、server-owned S3 keyへbindingする。
- token hashとS3 keyは一意にする。
- TTLは正数かつ最大10分とし、将来のpresigned URL既定5分を上回る異常な長寿命tokenを拒否する。
- consume timestampは作成後かつ期限内だけを許可する。
- S3 keyは`tmp/{userId}/entities/imports/`配下、MIMEに一致する拡張子、最大1024文字に制限する。
- entityをbindingする場合はdeployment invariantでpersonal work ownerまたは同一organization workであることを確認する。

## atomic single-use

Repositoryの`consume`はtoken hash、user、organization、purpose、未使用、期限内を1つのparameterized `UPDATE ... RETURNING`で判定する。同時requestのうち1件だけが行を更新し、replay・期限切れ・scope不一致はすべて`null`になる。

`inspect`はS3 objectを読む前のread-only確認用で、consumeしない。将来のServiceはS3 HEAD / GETとmagic bytes検証後、credit消費・解析の前にatomic consumeを通す必要がある。

## セキュリティ

- client pathをDBへ直接保存するAPIは追加しない。
- personal / organization scopeをtoken lookup条件から省略しない。
- MIMEはJPEG / PNG / WebP、sizeは1〜5 MiBに限定する。
- raw tokenはhash化前の値を永続化・ログ出力せず、将来の発行Routeから認証済みrequesterへ一度だけ返す。S3 credentialとprovider errorは応答しない。
- token rowはアクセス権を与えない。将来のRouteは認証とorganization `generate` capability、entity ownershipを別途検証する。

## 既存運用への影響

- データ構造: 新規tableだけ。既存table・rowを変更しない。
- API / UI: Route未接続のため変化なし。
- 画像保存・credit: 既存base64 importを維持し、変化なし。
- migration時間: 新規空tableとindexだけで、既存table scanはない。

## 後続条件

- server-generated keyだけを署名するS3 presigner
- Content-Type / Content-Length / SSEを署名対象にするテスト
- HEAD / GETのtimeout、retryable failure限定retry、MIME / size / magic bytes再検証
- token consumeとcredit / analysisの順序・失敗時UX
- 認証・personal / organization capabilityを持つRoute
- Mobile API contractとclient

## テスト方針

先にmigration、invariant、Repositoryを要求するテストを追加し、missing migration / module / invariantでredを確認した。実装後はfocused test、fresh PostgreSQL 001〜031、DB制約・atomic consume、invariant、Vitest / Bun、Backend build、Web lint/build、Playwright smokeを確認する。

## Sol / Terra

利用可能な`skills/lyra-sol-terra-orchestration`が作業環境に存在しないため委譲しない。schema・Repositoryの限定実装と全検証をSol相当の同一作業で行う。
