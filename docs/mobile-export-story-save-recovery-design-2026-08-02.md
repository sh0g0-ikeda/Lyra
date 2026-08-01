# Mobile 端末保存・ストーリー保存復旧設計（2026-08-02）

## 目的と範囲

Mobile の次の不具合を、現行 backend と保存済みデータの契約を変えずに解消する。

1. Pages の生成画像と、完成済み PDF / ZIP を端末へ保存できない。
2. Story の episode 保存が失敗し、未保存 episode を前提にした StoryAI も開始できない。

変更対象は Mobile の API request 変換、端末ファイル転送、保存結果表示と回帰テストに限定する。Route、Service、Repository、Worker、DB、生成 prompt、credit、organization scope は変更しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §2: story を保存し、生成済み page を画像・PDF・ZIPとして出力できること。
- 同 §4–5: 認証済み personal / organization scope と private export delivery を維持すること。
- 同 §8: bounded input、秘密情報を含まない安全な利用者向けエラーを維持すること。
- 同 §10: Mobile test、型、lint、contract、Android / iOS bundle と release gate を確認すること。

## 確定した原因

### Story 保存

Mobile の `UpdateEpisodePayload` は移行前 client 互換の `expected_updated_at` を必須としており、`buildEpisodeMobileUpdatePayload` と階層名称変更はこの項目を送る。一方、現行 backend の `updateEpisodeBodySchema` は `.strict()` でこの項目を受理せず、Route の validation で必ず 422 になる。PR #167 の cache / dirty-state 修正は API 成功後には有効だが、現状は成功処理まで到達しない。

### 端末ファイル保存

HTTP download と認証 scope は画像・PDFとも現行契約に合っている。本番の episode export route も未認証 request に 401 を返し、route 自体は有効である。

Android は system folder picker と SAF destination への native copy に依存する。DocumentProvider、復帰時の picker、または copy が失敗すると、cache に正常取得済みのファイルがあっても代替保存導線がなく終了する。また画像・PDFのどちらにも保存成功表示がないため、保存先へ書けた場合も利用者が完了を確認できない。iOS は system share sheet を使うが同様に完了表示がない。

## 設計

### Story request contract

- `updateEpisode` は既存 caller が渡す `expected_updated_at` を API client 境界で除去し、現行 backend schema が受理する field だけを一度送る。
- update payload の組み立て、保存成功 record の query cache 反映、dirty revision、StoryAI 前の dirty-save 順序は維持する。
- backend に新しい optimistic concurrency や migration を後付けしない。

### ファイル保存

- 認証付き download は従来どおり app cache へ行い、Bearer token を Lyra API origin だけに送る。
- Android は従来どおり SAF folder save を第一候補にする。利用者が picker を取消した場合は取消として終了する。
- picker / destination creation / native copy が端末固有理由で失敗した場合だけ、download 済み cache file を system share sheet へ渡す fallback を使う。再downloadやBase64展開はしない。
- Android / iOS とも、system save/share 処理が完了した場合は画面内に明示的な成功表示を出す。次の試行開始時に古い成功表示を消す。
- filename normalization、MIME 固定、organization query、短命 download URL、既存の安全なエラー分類を維持する。

## 影響レイヤーとインターフェース

- Mobile API: `apps/mobile/src/lib/api.ts`
- Mobile file boundary: `apps/mobile/src/lib/download.ts`
- Mobile UI: `PagesScreen`、`ExportJobCard`
- Mobile tests: story update request、download fallback、保存結果表示
- Backend / Web / DB / Worker / Infrastructure: 変更なし

## セキュリティ

- token、organization scope、owner-scoped endpoint は変更しない。
- cache URI と system picker / share sheet が返す URI 以外の端末 path は組み立てない。
- fallback は取得済みローカルファイルだけを共有し、署名URLやAuthorization headerを共有先へ渡さない。
- raw native error、provider error、storage key、secret を画面へ出さない。

## TDD と検証

1. episode update request body に `expected_updated_at` が含まれないことを先にテストし、現行実装で失敗を確認する。
2. Android SAF copy failure 時だけ system share fallback が動き、取消時には動かないことを先にテストする。
3. 画像と export artifact の保存成功表示を先にテストする。
4. 対象テスト、Mobile 全 test、typecheck、lint、contract、mojibake、Expo check、Android / iOS export を実行する。
5. Terra の read-only 最終レビューと GitHub CI を通した後だけ統合し、統合済み main と同じ tree から EAS preview APK を作る。

## Sol / Terra 分担

- Terra 1: page image / PDF download 経路、Expo file API、欠落テストの read-only 調査。
- Terra 2: StoryScreen、dirty-state、episode / scene request contract の read-only 調査。
- Sol: 設計、TDD、実装、統合判断、release gate、EAS build を担当する。
