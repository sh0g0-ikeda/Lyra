# Mobile production redirect contract

## Design brief

- **Purpose and scope:** Keep the native Cognito callback and logout values
  mechanically consistent across the mobile runtime, Expo configuration, EAS
  profile metadata, examples, deep-link parsing, and a production-public-config
  release preflight.
  This change does not alter Cognito allowlists, EAS environments, updates,
  binaries, API authentication, or universal-link routing.
- **Spec basis:** Unified Spec sections 4 (authentication remains fail closed),
  8 (configuration failures never expose credentials), and 10 (release runtime
  configuration is verified before deployment).
- **Affected layer:** Mobile configuration and native/app-link contract only.
- **Interface:** The non-secret JSON contract defines canonical native callback
  and logout URIs separately from HTTPS universal-link paths, then derives the
  required production public environment: build environment, app-link host, API
  origin, Cognito domain/client/scopes, native callback/logout URIs, and the
  organization-feature flag. Production app config and the local preflight
  reject mismatches by variable name only.
- **Security:** No redirect URI allowlist is widened. Hybrid
  `lyra-mobile://auth/mobile/*` links remain invalid. Diagnostics must never
  include supplied environment values or other public/private configuration.
- **Testing:** Start with contract, Expo config, local-preflight, and deep-link
  rejection tests; then run targeted tests, mobile typecheck, lint, Expo config
  metadata checks, and a scoped diff review.
- **Terra delegation:** No delegation. The contract is a small, tightly coupled
  mobile-only change; a single owner can preserve the injection behavior across
  all consumers and review the complete surface together.

## Release operator boundary

`npm run preflight:production-config` validates an already-provided production
public-environment shape. It does not print values, build, publish, or mutate a
release.

The release command must load the actual EAS `production` environment before
the check. The repository pins this invocation to the EAS CLI version whose
`env:exec` support was verified:

```text
npm run preflight:production-config:eas
```

It expands to an `eas env:exec production` command, then runs the local check.
It may read the EAS environment but does not change it. Do not replace it with
a local shell invocation before an EAS build or update, because that would not
verify the values resolved by the production environment.
