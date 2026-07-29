# Mobile Production External State Design

## Purpose and scope

This change closes the production AWS configuration portion of
`MOB-API-006`, `MOB-AUTH-001`, `MOB-AUTH-005`, and `MOB-REL-004`.
It does not deploy the feature branch application image, create Apple
credentials, configure a store, or claim physical-device acceptance.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` sections 4, 5, 8, and 10: Cognito
  authentication, opaque S3 keys, bounded uploads, and release verification.
- `docs/mobile_completion_gap_spec.md`: production HTTPS auth callbacks,
  one-day temporary-upload cleanup, idempotent account-asset lifecycle
  scheduling, and production configuration evidence.

## Affected layers and interfaces

- Ops: Cognito app-client callback/logout URLs and S3 lifecycle/CORS state.
- Infrastructure: existing presigned PUT headers and exact-key account
  deletion tags. No application interface or database contract changes.
- Web/Mobile: fixed `https://app.lyra-editor.com` origin and the existing
  `/auth/mobile/*` paths.

## Security and rollout

- Preserve every existing Cognito app-client setting while adding only the two
  fixed production HTTPS URLs.
- Preserve the production bucket's incomplete-multipart and noncurrent-version
  rules while reducing only `tmp/` current-object retention from 14 days to
  one day.
- A tag-filtered lifecycle rule must not contain an
  `AbortIncompleteMultipartUpload` action. The bucket-wide one-day abort rule
  already covers incomplete uploads.
- S3 CORS permits only the production Web origin, `PUT`, the two signed request
  headers, and the non-sensitive `ETag` response header.
- Public Mobile association and legal files use only
  `public/mobile/*` in the private image bucket. The bucket policy grants
  `GetObject` only to the exact application CloudFront distribution, and
  CloudFront routes only the five declared public paths to that origin.
- User image prefixes remain unreachable through the public static origin.
  The application image and default CloudFront behavior remain unchanged.
- The API task role preserves its existing image, queue, secret, and SES
  permissions. Account deletion adds only exact `saved/*` object-tagging
  actions and Cognito disable/delete actions scoped to the production pool.
- Android push uses a dedicated Firebase project registered to
  `com.lyra.mobile` and the signature-verified EAS certificate. The Android
  client file is an EAS file secret. The FCM sender credential is a dedicated
  service account with only `roles/firebasecloudmessaging.admin`, stored only
  in the production AWS secret.
- The Firebase Android API key keeps Firebase's service allowlist and adds an
  Android application restriction for `com.lyra.mobile` plus the SHA-1 derived
  from the same signature-verified EAS certificate. OAuth acquisition and an
  FCM `validate_only` request must succeed without logging either credential.
- FCM setup alone does not enable push. `PUSH_NOTIFICATIONS_ENABLED` remains
  false until APNs credentials are also installed and both provider paths can
  pass real-device delivery tests.
- Release-like Android artifacts are inspected after EAS build. The application
  uses only the system image library picker and has no camera or screen-overlay
  feature, so `CAMERA`, `RECORD_AUDIO`, and `SYSTEM_ALERT_WINDOW` are blocked
  from the merged manifest. Signature, package/version, deep links, notification
  permission, Firebase components, and exported components are verified against
  the downloaded APK rather than inferred from source configuration.
- Production updates require immediate AWS readback. No secret values are
  written to source, logs, or documentation.

## Test and delegation plan

Repository tests validate the complete lifecycle and CORS documents before
they are applied. AWS readback then verifies the effective rules and Cognito
URLs. Terra performs a read-only completion-gap audit; Sol owns production
changes, integration decisions, and final verification.
