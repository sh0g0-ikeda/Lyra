# npm credential-provider lock repair

The Windows independent audit found that package.json and bun.lock declare
@aws-sdk/credential-providers 3.1078.0, while root package-lock.json omits it
and its Cognito identity closure. Reconstruct only these three npm records from
the existing reviewed Bun lock, retaining its exact versions, dependency ranges
and SHA512 integrity. Preserve all existing npm resolutions and the production
Bun lock. This repairs metadata consistency; it neither downloads packages nor
enables state-copy admission or AWS calls.

The node:test contract checks all root dependency declarations and verifies the
three reconstructed records against Bun, including closure presence. Actual
offline runtime/type checks still need the three package archives: metadata alone
does not provide executable dependencies. Existing local copies and caches were
checked without network requests and did not contain these versions.
