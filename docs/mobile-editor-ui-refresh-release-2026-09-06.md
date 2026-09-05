# Mobile editor UI refresh 1.0.3 配布結果

2026-09-06 JST。ユーザー指定の画面整理・日英文言・コマ追加を実装、レビュー、検証し、Android AAB / APK を作成して iOS ビルドを App Store Connect に提出した。

## ソースと成果物

実装コミット: `35416938d38e7c2a4972d24107327ae74df92401`。この3成果物はすべて同じ reviewed commit のクリーンな worktree から、EAS production 環境で作成した。この記録を追加する後続コミットはドキュメントのみで、配布コードに変更はない。

PR: https://github.com/sh0g0-ikeda/Lyra/pull/203

| 成果物 | ID / version | EAS | 完了時刻 JST |
|---|---|---|---|
| Android AAB | `com.lyra.mobile` / 1.0.3 / code 93 | [build](https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/bef4327c-43e4-4d7c-b381-1f3f1239d787) | 02:28:00 |
| Android APK | `com.lyra.mobile` / 1.0.3 / code 94 | [build](https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/a09d8729-4fad-44d2-a255-ff24f674490f) | 02:33:10 |
| iOS IPA | `jp.lyra.mobile` / 1.0.3 / build 35 | [build](https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/dc97a517-2847-4abd-8e57-40b996f7353f) | 02:19:49 |

ローカル成果物は `.tmp/mobile-editor-refresh-20260906/artifacts/` に保存した。

- `Lyra-Mobile-1.0.3-code93.aab`: 72,578,020 bytes
- `Lyra-Mobile-1.0.3-code94.apk`: 108,215,668 bytes
- `Lyra-Mobile-1.0.3-build35.ipa`: 23,444,962 bytes

## 署名・形式の検証

- AAB: bundletool 1.18.3 `validate` 成功。Manifest の package / version / code を確認。`jarsigner` は `jar verified`。JarInputStream の manifest 配置警告を切り分けるため、JarFile の署名検証を有効にして全1436 non-META-INF entriesを読み、期待する証明書で署名されていることと、ZIP path に重複がないことを検証した。
- APK: apksigner の v2 signature verification 成功。AAB と同じ署名証明書。aapt2 で package / version / code / ABI を確認。zipalign の16KBチェックと、arm64-v8a / x86_64 の48 ELFライブラリすべての LOAD segment alignment >= 16KB を確認した。
- Android: min SDK 24、target SDK 36。APK ABI は arm64-v8a / armeabi-v7a / x86 / x86_64。
- iOS: IPA 内の Info.plist から bundle ID / version / build 35 を確認。UIDeviceFamily は `[1, 2]`、MinimumOSVersion は16.4。署名リソースと provisioning profile の収録を確認。macOSでの独立した codesign 検証は行っていない。

Android upload certificate SHA-256:

```text
dddf947c55aebb158251379205d8774729dfbdc0979008eb93476696b878200b
```

成果物 SHA-256:

```text
b617a1e46c8f96d1c6093cf15411b55d2b81586540aaaf36ad2329a97efccc72  Lyra-Mobile-1.0.3-code93.aab
b2dbbfecf0bc7683d7988db430ca330a7fb2e07e874d23ff52f27353f0d747a7  Lyra-Mobile-1.0.3-code94.apk
faaf0fcde39ed06b5af30ee7521d9a5d196528645ae6404cd266bad8b4d039d1  Lyra-Mobile-1.0.3-build35.ipa
```

## Apple 提出

`eas submit --platform ios --profile production --id dc97a517-2847-4abd-8e57-40b996f7353f --non-interactive --no-wait --no-auto-testflight-setup` で、上記ビルドを指定して提出した。

- [EAS submission](https://expo.dev/accounts/sh0g0/projects/lyra-mobile/submissions/1d8e6070-642d-4660-ae0a-6194a1e4b97a)
- App Store Connect app ID: `6797564060`
- EAS submission status: `FINISHED`
- 完了時刻: 2026-09-06 02:25:28 JST

ローカルの `eas submit:status` は提出前後とも Apple REST API の401で失敗したが、EASサーバーからの提出は完了した。認証キーは変更していない。Apple側の processing / 審査 / 公開状態は、この照会経路では確認できていない。今回の結果はビルドの提出完了であり、ストア公開の完了を意味しない。Google Playへのアップロードは行っておらず、提出用AABを作成した。

## 検証と残る確認

- Mobile: 134 files / 661 tests、TypeScript、ESLint、API contract、API inventory、Web parity、文字化けチェックが成功。
- Expo: dependency check、Doctor 21/21、production 環境の Android / iOS Hermes export が成功。
- Backend: 236 files / 1636 Vitest tests、26 Bun tests、TypeScript build が成功。専用のローカル PostgreSQL で migration と50 deployment invariants が成功。
- Web: lint / production build / Playwright 21 tests が成功。
- 実装コミットの GitHub CI は mobile-verify / verify とも成功。
- 実機・emulatorは未接続のため、実機での目視・タップ・キーボード・safe-area確認は未実施。
- AWS production は read-only 照合のみ。API `lyra-prod-api:129` が2/2、`/readyz` 200であることを確認。backend / migration / AWS設定は変更していない。

既存の未コミット変更として、cloud-cost / cloud-current-state の2資料、`scripts/createDockerLearningDocx.py`、`HANDOFF.md`、root `app.json`、2件のmockup画像、`store-assets/google-play/` を元の作業ツリーに保持した。これらは実装コミットにもビルドarchiveにも含めていない。
