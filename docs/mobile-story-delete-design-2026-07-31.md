# Mobile story deletion design

## 目的と範囲

PR #138 で安全化した既存の chapter / episode 削除 API を Mobile の Story 階層編集へ接続する。選択中の章または話だけを明示確認後に削除し、未保存の話 draft、query cache、選択状態、生成 job / export / S3 asset の Backend 保護契約を壊さない。

この slice では作品削除、並べ替え API の追加、生成画像や export artifact の durable cleanup、scene / Story AI / page skeleton、Characters、Pages は実装しない。DB schema、Backend request / response、credit、Worker、production feature flag も変更しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §3: Mobile は client 境界、認可・永続化・job 整合性は Backend 境界に置く
- §4: personal ownership / active organization membership を既存 query scope で送る
- §5: active job、未削除 artifact、保存済み生成画像がある chapter / episode は sanitized 409 で fail closed にする
- §6: Mobile から job state、retry、credit、Worker state を直接変更しない
- §8: raw server error を表示せず、安定した日本語・英語メッセージへ変換する
- §10: API、Mobile component、typecheck、lint、両 OS export、全 release gate を確認する

## UI と操作順

- 削除ボタンは既存の「階層を編集」内で、選択中の章または話の移動操作と同じ section に置く。作品削除ボタンは表示しない。
- ボタンは danger tone とし、章削除では配下の話・scene・page・panel も対象になること、話削除では配下の scene・page・panel も対象になること、元に戻せないことを確認 dialog に明記する。
- 実行順は `削除確認 -> dirty draft の保存 / 破棄 / 取消 -> DELETE` とする。削除確認を取り消した場合は保存確認を出さない。
- dirty draft で保存を選んだ場合は保存成功後だけ削除する。保存失敗、dirty prompt の取消、削除確認の取消では DELETE を送らない。
- hierarchy mutation、保存、削除確認、選択遷移は single-flight とし、連打や応答順で二重削除・古い選択への巻き戻りを起こさない。

## API とエラー

- `DELETE /api/chapters/:id` と `DELETE /api/episodes/:id` は optional `organization_id` を既存 mutation と同じ query で送り、成功は 204 のみ受理する。
- 401 の token refresh は既存 API client と同じ一回だけの再送を使う。
- 409 は「生成中の処理または未削除の生成 file があるため削除できない」と表示し、対象、cache、draft を保持する。
- 404 は親一覧を再取得し、対象が消えていることを確認できた場合だけ該当 cache / selection を除く。再取得失敗または対象が残る場合は状態を保持する。tenant や blocker の詳細は表示しない。
- network / 5xx / invalid response は一般的な削除失敗として対象、cache、draft を保持する。raw response body、job ID、S3 key は表示しない。

## 成功後の cache と選択

- 話削除: current chapter の episode query を cancel し、成功後だけ対象を除く。同じ index の次の話、なければ直前の話を選択し、どちらもなければ editor を閉じる。
- 章削除: work の chapter query と削除対象 chapter の episode query を cancel し、成功後だけ対象 chapter とその episode cache を除く。同じ index の次章、なければ直前の章を選択し、episode editor は閉じる。
- 成功後に対象 list を `refetchType: none` で stale にし、次の利用時に server と再同期する。削除失敗では optimistic removal を行わない。
- query key は既存の session + personal / organization scope を維持し、workspace 間で cache を共有しない。

## セキュリティと影響

- Mobile は対象 ID と organization scope だけを送り、Backend の ownership / membership / blocker 判定を迂回しない。
- 生成済み story は PR #138 の fail-closed 境界により削除できない場合がある。これは durable asset cleanup 実装までの既知の安全制約である。
- 成功時は既存 DB cascade の時間に加えて list cache 更新だけで、Mobile 固有の追加 network call は不要。404 のときだけ再同期する。
- API response data structure は増やさず、204 no-content を明示処理する。

## TDD と検証

先に次の失敗テストを追加する。

- personal / organization の chapter / episode DELETE が body なしで正しい URL を使い、204 以外の成功応答を拒否する
- 削除確認取消、dirty prompt 取消、dirty 保存失敗では DELETE しない
- dirty 保存成功後だけ DELETE する
- episode / chapter 成功後だけ cache と選択を安全な sibling / empty へ移す
- 409 / network failure で draft と選択を保持し、raw error を表示しない
- 404 で stale target を除き、連打では一度だけ送信する
- 日本語・英語 label、danger tone、accessibility role を維持する

その後 Mobile の対象 test / typecheck / lint / contract / Expo check / 両 OS export、Backend / DB / Web / Playwright の release gate を実行する。

## Terra 委譲

Terra は既存 Story screen、API client、dirty prompt、query cache、tests の read-only 監査だけを担当する。Sol が設計、TDD、実装、差分レビュー、統合判断を所有する。
