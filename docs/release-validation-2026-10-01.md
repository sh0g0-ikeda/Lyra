# ローカル検証結果（2026-10-01）

## 対象

この表の対象は凍結候補 `1d512194dd0ee506102adc8bb773c2dfcaba28a8`
（`chore/release-readiness-2026-10-01`）。2026-10-02 の状態copy修正後の候補と検証結果は
`release-state-copy-addendum-2026-10-02.md` および新しい配布 manifest を参照する。
旧版の成果物は保存し、以下の成功件数を修正版の結果として流用しない。
各領域の途中 commit はレビュー用の分割であり、個別反映単位ではない。最終 head 全体を使う。

統合元は `2bb4e2dabd24c3116c5dae86a177754b367e245d`、最後の旧 UI checkpoint は
`f89ac1dd95002937c2fbe89481afe54ed937d690`。この2つの古い成功結果を最新版の証拠に流用しない。
実本番 source `2debe8c3c22633ed077e7b189ddcfa8b209a00dc` の契約を別途照合した。

## 実行して成功したもの

| 検証 | 結果 | 条件 |
|---|---|---|
| backend Vitest | 337 files / 2,472 tests | 全 unit＋integration、使い捨て PostgreSQL 18.3、APP_ENV=test |
| backend native Bun test | 337 files / 2,472 tests、0 fail | 同じ PG18.3 fixture、実際に DB test を実行。timer／mock の両 runner 互換を修正 |
| PostgreSQL16 integration | 20 files / 164 tests | migration、旧本番 bridge、quote、CAS、返金、削除、認証、push 等。実顧客データ不使用 |
| production bridge focused | PG16/18 とも48 tests | 26 real-source bridge cases、成功 fixture 全てで最後の deployment invariant も検査 |
| fresh migration CLI | PG16/18 とも成功 | 001–046適用、deployment invariant 65件 ok、lineage=candidate／blockers=[] |
| backend TypeScript | 成功 | bun run build |
| API 契約同期・inventory | 成功、150 endpoints | canonical Mobile schema の生成一致と literal route inventory |
| Mobile Vitest | 183 files / 926 tests | 最終 F21 の画面外話者・未知ID保持、push capability、UI 整理まで含む |
| Mobile typecheck / lint / mojibake | 全て成功 | lint は max-warnings=0、日英 catalog と source を検査 |
| Web lint / build | 成功 | 既存 console と新 Google／provenance。bundle サイズ警告は下記 |
| Web Google focused | Vitest/Bun とも61 tests | fake popup／PKCE／callback／session／receipt。実認証ではない |
| 分離 Web build | 成功 | Docker web-build と同じ共有 packages 配置、既存 lockfile の依存、strict production config。Docker 自体は未実行 |
| Android offline export | 成功 | Expo offline/no-telemetry、Hermes JS/assets。署名 APK/AAB ではない |
| iOS offline export | 成功 | Expo offline/no-telemetry、Hermes JS/assets。署名 IPA ではない |
| diff / historical migrations | 成功 | 統合元→最終headの git diff --check、001–041 は変更なし。固定production SQLは元bytesの改行を保存 |

ローカル runtime は Bun 1.3.10／Node 24.19.0。Dockerfile は Bun 1.3.14 を指定するため、
同版 runtime／ARM64 の実 image build・起動・digest 検証は CI／許可された build 環境のゲートに残る。
Docker engine はこのクラウド workspace にない。共有 schema の Docker build context 漏れは修正し、
分離されたファイル配置で Web を build したが、これを container build 成功とは呼ばない。

## 再現して修正した失敗の扱い

- stale API inventory、runner 非互換の vi helpers／timer cleanup を直して全体を再実行した
- 通常 login の email-only subject 変更を全 provider で禁止し、signup と credit の transaction を実 API へ接続した
- credit grant の23505を user insert競合と誤認する試験を RED→GREEN で修正した
- 旧 completed deletion と stale push の bridge後不変条件違反を合成DBで再現。
  事前 blocker とし、旧 row を変更しない回帰と post-migration invariant を追加した
- 非表示 alias の「Ace, Jr.」を CSV 再分割する保全バグ、画面外話者の Mobile 入力制限を回帰で修正した
- Web 初期化で storage／popup API が throw すると画面が描画されない問題を安全な回復表示へ修正した
- Web の canonical schema を Docker web-build がコピーしない問題を static RED→GREEN と分離 build で確認した

途中の失敗ログを成功扱いにせず、修正後の上表だけを最終候補の証拠とする。

固定 production SQL fixture は Git の改行自動変換を無効化し、元 commit の SHA-256 と照合する。
元SQLに存在する末尾空行は証拠の byte 一致を優先して保存し、この fixture 範囲だけその whitespace 警告を除外する。
アプリの source に追加された末尾空行は除去している。

## 未実行・未検証

- GitHub の今回の PR／CI：write が403。別経路の push、merge、release は行っていない
- Playwright の実 browser、native Maestro、small-screen／desktop／大字／safe-area の実画面受入：未実行。
  Chromium は環境の socket 制限で起動不可、cloud browser の loopback 接続も blocked。
  mock render／PNG の番号ガイド実見はアプリ画面の visual QA の代替ではない
- 現行ストア binary と候補 build の実機、購入／復元、通知、Google、保存共有／退会の受入：未実施
- AWS の実 DB schema/history/size/locks、subject監査、runtime secrets/flags、匿名化した実データ staging：未確認
- 新規 Cognito/Google 設定・IAM、Hy4 image契約、iOSログイン公開判断、実画像の品質／原価／remote fault：未了
- Docker image、署名 Mobile build、EAS、ストア提出、OTA、production deploy／migration：作成・実行していない

Web build は main chunk が約695kB（minified）で500kB超の警告がある。build は成功したが、
実端末での起動／操作性能は未測定。警告を消すために閾値だけを上げていない。

## 機能公開の判定

各機能のコードと「利用可能」は別である。Google、state、quote は既定 OFF。
新 Mobile の有料操作は quote 必須なので、quote OFF のまま完成版として配布してはいけない。
Hy4 は無断代替せず未提供。新規 preset の具体値／利用頻度順は未確定のまま既存値を守る。
残ゲート、段階反映、forward-only rollback、最低限の実機項目は release-readiness 文書を参照する。
**この検証結果から『実機を確認すれば即本番反映可能』とはまだ言わない。**
