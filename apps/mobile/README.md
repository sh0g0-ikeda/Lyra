# Lyra Mobile

Expo / React Native / TypeScript implementation for Android and iPhone.

This app is intentionally isolated under `apps/mobile` and calls the existing Lyra API. Personal digital purchases use StoreKit or Google Play through the server-owned product catalog. Organization billing remains server-authoritative and opens the permitted Web management flow.

## Setup

```bash
cd apps/mobile
npm install
cp .env.example .env
npm run start
```

Use `EXPO_PUBLIC_COGNITO_API_TOKEN_USE=id_token`. API requests send `Authorization: Bearer <id_token>`.

## Verification

```bash
npm run typecheck
npm run lint
```

## Device Testing

Use a development build for Cognito sign-in because the app relies on the custom URL scheme `lyra-mobile://`.

```bash
cd apps/mobile
npm install
npx expo install --check
npm run typecheck
npm run start:dev-client
```

Required Cognito Hosted UI URLs:

- Callback URL: `lyra-mobile://auth/callback`
- Sign-out URL: `lyra-mobile://auth/logout`

Required `.env` values:

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_COGNITO_DOMAIN`
- `EXPO_PUBLIC_COGNITO_CLIENT_ID`
- `EXPO_PUBLIC_COGNITO_REDIRECT_URI=lyra-mobile://auth/callback`
- `EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI=lyra-mobile://auth/logout`
- `EXPO_PUBLIC_COGNITO_API_TOKEN_USE=id_token`

## Native Push

Android builds require a Firebase `google-services.json`. Configure it as an EAS
file environment variable named `GOOGLE_SERVICES_JSON`; do not commit the file.
iOS builds require the Push Notifications entitlement and valid APNs credentials.
The API-side APNs/FCM credentials and push-token encryption keys are server secrets
listed in the root `.env.example`, never Mobile environment variables.
