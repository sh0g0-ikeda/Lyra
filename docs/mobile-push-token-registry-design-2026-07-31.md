# Mobile push token registry design

## 目的と範囲

iOS / Androidのnative push tokenを平文保存せず登録・更新・logout解除できる内部基盤を追加する。

対象はdomain定数・型、AES-256-GCM / HMAC adapter、Registry Service、transactional Repository、migration 033、deployment invariant、テスト、Specとtask listである。Route、`src/app.ts`配線、Mobile端末の通知権限要求、APNs / FCM送信、push outboxは接続しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Authentication and authorization / Persistence and tenancy / Input and output safety
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-D / DB-300 migration 033

## PR #67案から変更する理由

PR #67のmigrationはhashを32〜256 byteの任意文字列、ciphertextを長さだけで許可していた。実装adapterはHMAC-SHA-256 hexとversioned AES-GCM envelopeを生成するため、DBもその形式に合わせ、平文や別形式の誤保存を拒否する。

## 暗号契約

- token暗号化はAES-256-GCM、12 byte random IV、16 byte authentication tag、固定AADを使う。
- 保存形式は`v1.{iv-base64url}.{ciphertext-base64url}.{tag-base64url}`とする。
- lookup用hashは別の32 byte keyを使うHMAC-SHA-256 lowercase hexとする。
- encryption keyとhash keyの同一設定を拒否する。
- keyはcanonical base64の32 byte、key IDは1〜64文字の限定文字だけを許可する。
- decrypt失敗はraw暗号値や内部例外を公開しない安定したConfigurationErrorへ変換する。

## 登録・解除

- 登録入力はServiceでもUUID installation ID、ios / android、ja / en、16〜4096文字で空白なしのdevice tokenに限定する。
- Serviceはadapter出力が平文と異なり、hash / envelope / key ID契約を満たすことをRepository呼出し前に再確認する。
- Repositoryはpush registry専用のadvisory transaction lockを取り、同一端末の旧tokenを削除してhashをupsertする。登録頻度は低いため、2端末間でtokenを入れ替える競合も含めて直列化する。
- tokenが別userへ移る場合もunique hashの1行だけを維持する。
- logout解除も同じregistry lock内で`user_id + installation_id`へscopeしたDELETEを行い、登録との競合を直列化する。他userの端末登録は削除せず、対象が存在しなくても成功する。
- 応答型はinstallation IDとplatformだけで、hash・ciphertext・key IDを返さない。

## DB契約

- `mobile_push_tokens`はuser削除にcascadeする。
- token hashと`user_id + installation_id`をそれぞれuniqueにする。
- hashはlowercase hex 64文字、ciphertextはversioned envelopeかつ最大16 KiB、key IDは限定文字、localeはja / enに固定する。
- `updated_at >= created_at`を保証し、userごとの更新順indexを追加する。
- deployment invariantでも保護形式とtimestampを継続監査する。

## セキュリティ

- plaintext token、暗号鍵、hash鍵をDB、ログ、応答、テストfixtureへ保存しない。
- DBのciphertextだけでは送信できず、runtime secretのencryption keyが必要である。
- schema / Service / Repositoryを追加してもRoute未接続のため、外部から登録・解除できない。
- Push provider送信とnotification payloadは後続PRで別途認可・最小情報化する。

## 既存運用への影響

- 新規tableと未配線moduleだけで、既存API、generation job、credit、Web / Mobile UIは変化しない。将来の登録処理はregistry単位で直列化されるが、端末token登録は低頻度のため待ち時間への影響は軽微と見込む。
- migrationは空table作成のみで既存table scanを行わない。
- 環境変数やsecretをまだ要求しない。adapterを`src/app.ts`へ配線する後続PRで初めて必要になる。

## テスト方針

先にmigration、cipher、Service、Repository、invariantのテストを追加し、missing module / migration / invariantでredを確認する。実装後は暗号round-trip、改ざん・key分離、secret非返却、transactional upsert、scoped delete、fresh PostgreSQL 001〜033、DB negative cases、全verification gateを確認する。

## Sol / Terra

利用可能な`skills/lyra-sol-terra-orchestration`が作業環境に存在せず、上位ルール上sub-agent委譲も行わない。暗号・永続化判断を含むため同一作業で設計・実装・検証する。
