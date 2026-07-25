# Lyra Mobile Environment Matrix

This table is the checked-in contract for Mobile bundle identifiers, callback
origins, association files, and public store product mapping. Secrets are never
stored here or in the Mobile bundle.

| Item | Development | Preview | Production |
|---|---|---|---|
| Build environment | `development` | `preview` | `production` |
| iOS bundle ID | `com.lyra.mobile` | `com.lyra.mobile` | `com.lyra.mobile` |
| Android application ID | `com.lyra.mobile` | `com.lyra.mobile` | `com.lyra.mobile` |
| API origin | Local developer URL | EAS `preview` environment | `https://app.lyra-editor.com` |
| Cognito callback | `lyra-mobile://auth/callback` | `lyra-mobile://auth/callback` | `https://app.lyra-editor.com/auth/mobile/callback` |
| Cognito logout callback | `lyra-mobile://auth/logout` | `lyra-mobile://auth/logout` | `https://app.lyra-editor.com/auth/mobile/logout` |
| Apple association | Not generated | `https://app.lyra-editor.com/.well-known/apple-app-site-association` | `https://app.lyra-editor.com/.well-known/apple-app-site-association`, generated from `APPLE_DEVELOPER_TEAM_ID` |
| Android association | Not required | `app.lyra-editor.com` / EAS APK certificate | `app.lyra-editor.com` / `com.lyra.mobile` / `DD:DF:94:7C:55:AE:BB:15:82:51:37:92:05:D8:77:47:29:DF:BD:C0:97:90:08:EB:93:47:66:96:B8:78:20:0B` |
| Store product mapping | None | Sandbox values from EAS environment | Production values from the server-owned product catalog |
| Android Firebase client config | Local file outside Git | EAS file secret `GOOGLE_SERVICES_JSON` | EAS file secret `GOOGLE_SERVICES_JSON` |
| APNs environment | Sandbox | Sandbox | Production |
| Push provider credentials | Disabled or local secrets | Server secret store | FCM installed in AWS; APNs pending |
| Crash reporting | Disabled | Disabled | Sentry DSN from EAS `production` environment |
| Source map upload | Disabled | Disabled | EAS sensitive secrets `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` |

Production configuration is accepted only when the API origin and HTTPS
callbacks match this table. Public Cognito identifiers may be embedded; Cognito
client secrets, AWS credentials, Stripe secrets, and store credentials must not
use any `EXPO_PUBLIC_*` variable.

Native app-link configuration is environment-owned. Development removes iOS
associated domains and Android HTTPS intent filters, leaving the `lyra-mobile`
custom scheme only. Preview and production require the hostname-only
`EXPO_PUBLIC_APP_LINK_HOST`; the checked-in EAS profiles use the currently
deployed `app.lyra-editor.com`. Production rejects every other host during Expo
config evaluation. The same validated host is used for the iOS association and
the Android callback, logout, and invitation intent filters.

`EXPO_PUBLIC_SENTRY_DSN` is a public ingestion identifier and is required by the
production runtime validator. Crash events are scrubbed in the client before
delivery. Sentry's source-map upload token is a credential and must use EAS
sensitive visibility; it must never use an `EXPO_PUBLIC_*` name or appear in this
repository.

Native push requires two independent configuration surfaces:

1. The Android application build receives `google-services.json` through the EAS
   file secret `GOOGLE_SERVICES_JSON`. The file is never committed.
2. The API process receives token-encryption keys, the APNs `.p8` key, and Firebase
   service-account JSON through the server secret store. It sends only generic job
   status copy and opaque UUID routing fields.

The Android client file, dedicated FCM sender credential, and token-encryption
keys are installed. `PUSH_NOTIFICATIONS_ENABLED` remains `false` until APNs is
also installed, the application revision containing the push implementation is
deployed, and real-device delivery passes on both platforms. iOS signing must
enable the Push Notifications entitlement and APNs key access for
`com.lyra.mobile`.

The Android fingerprint above was extracted from and signature-verified against
EAS build `60107a7c-6b9a-4eed-a834-d80353bb4d94` (build 20). The downloaded APK
also contains the registered Firebase project, App ID, and sender ID. It must be
updated if the upload/signing key changes. The production Web image fails its
build unless `APPLE_DEVELOPER_TEAM_ID` is a valid ten-character Team ID. The
checked-in generator combines it with `com.lyra.mobile` and authorizes only
Mobile auth and invitation paths. The real value, deployed HTTPS response, and
device association cannot be finalized until an Apple Developer account and
signed iOS build exist.
