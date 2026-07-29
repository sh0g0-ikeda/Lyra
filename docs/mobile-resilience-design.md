# Mobile resilience design

## Purpose and scope

This slice closes the client-side portions of `MOB-STATE-003` and the safe
error-presentation portion of section 6.10. It adds one network-state source for
React Query and all screens, keeps cached reads visible while offline, pauses
network mutations, refreshes active queries after reconnect, and prevents raw
backend, provider, path, token, or stack text from reaching the UI.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` sections 8, 9, and 10
- `docs/mobile_completion_gap_spec.md` `MOB-STATE-003`, section 6.10, and
  release verification requirements

## Interfaces and security

- `@react-native-community/netinfo` is the device connectivity source.
- TanStack Query `onlineManager` is the request gate. Queries may render cached
  data offline; online-mode queries and mutations pause instead of sending.
- A reconnect changes the online manager to online and lets active queries
  refetch under their existing authenticated and tenant-scoped query keys.
- The global banner states that edits remain on screen and must not imply a
  successful server save.
- User-facing error mapping uses stable status/code categories only. Unknown
  `error.message`, provider payloads, file paths, stack traces, and credentials
  are never displayed or logged by the render error boundary.

## Testing

Tests are written first for safe unknown-error fallback and the network state
normalizer. Focused tests, typecheck, lint, mojibake, then the full Mobile suite
are required.

## Delegation

The preceding Terra audit identified the gap. Sol owns integration because the
provider, query client, root app, and shared screen component are coupled.
