# Mobile PDF 保存フロー修正設計（2026-08-01）

## 目的と範囲

Mobile の「保存」UIで生成済みPDFを端末へ保存できるようにする。変更対象は Mobile の端末保存処理とその回帰テストに限定し、episode export のAPI、ジョブ、永続化、PDF生成形式、認証・認可契約は変更しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` の Product goals: 選択ページを PDF / ZIP として出力できること。
- 同 Spec の Files and images: 本番ファイル配信は認証済み export または短命URLを使うこと。
- 同 Spec の Episode export: owner scope、immutable snapshot、非同期job、sanitized errorを維持すること。

## 現状調査と原因

保存フローは「export job作成 → status polling → 認証付きdownload → 端末保存」の4段階である。本番APIでは未認証のexport作成要求が401となり、少なくともrouteが有効であることを確認した。

Androidの端末保存だけは、download済みファイル全体をBase64文字列としてJavaScriptメモリへ読み込み、さらに同じ内容をStorage Access Frameworkへ書き戻している。PDF上限に近いファイルではBase64化と文字列表現により元ファイルの数倍のメモリを消費し、画像では成功しても複数ページPDFで中断し得る。また、Storage Access Frameworkの作成名には拡張子なしの表示名を渡す契約であるが、現在は拡張子付き名称を渡している。

## 設計

- 認証付きHTTP downloadと一時cacheへの保存は現状維持する。
- Androidは保存先フォルダを利用者に選択してもらい、Storage Access Frameworkで保存先を作る。
- cacheファイルから保存先content URIへの転送は `expo-file-system` のネイティブ `File.copy` を使う。JavaScript/Base64へファイル内容を展開しない。
- Storage Access Frameworkへは安全化済みファイル名から末尾拡張子だけを除いた表示名を渡し、MIME typeから適切な拡張子を付けさせる。
- iOSは既存の共有シート経由の「ファイルに保存」を維持する。
- cancel、容量不足、network、共有不可の既存エラー分類を維持する。

## 影響レイヤーとインターフェース

- Mobile: `apps/mobile/src/lib/download.ts` とテスト。
- Route / Service / Repository / Domain / Infrastructure / Worker / Web / DB migration: 変更なし。
- 入力: 認証token、owner-scoped download path、表示ファイル名、MIME type。
- 出力: Androidは保存先content URI、iOSは共有したcache URI。
- 永続化: 変更なし。端末の利用者選択フォルダにだけ新規ファイルを作成する。

## セキュリティ確認

- bearer tokenとorganization scopeを含む既存download pathを維持する。
- ファイル名の予約文字除去、長さ上限、拡張子のMIME type固定を維持する。
- raw provider error、secret、storage keyをUIへ追加しない。
- 任意の端末パスを組み立てず、Android標準のStorage Access Frameworkが返すURIだけを使う。

## テスト方針

1. 先にAndroid PDF保存のテストを、ネイティブcopyが呼ばれBase64 read/writeが不要という期待へ変更し、現行実装で失敗することを確認する。
2. PNG保存、PDF保存、フォルダ選択取消、iOS共有、download失敗分類を対象テストで確認する。
3. Mobileのtest / typecheck / lint / contract / mojibake / Android export / iOS exportを実行する。
4. export API契約に変更がないことを既存route/serviceテストで確認する。

## Sol / Terra 分担

Terraにはread-onlyで現行フロー、欠けている検証、最小変更候補を調査してもらった。Solが調査結果と実装をレビューし、変更はMobileの保存境界だけに限定する。
