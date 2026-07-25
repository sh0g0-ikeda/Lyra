# Mobile account deletion operations

## S3 lifecycle

`S3AccountAssetLifecycle` adds the object tag
`lyra-deletion-state=pending`. It does not immediately delete the object.
Production `S3_BUCKET_IMAGES` must contain a lifecycle rule equivalent to
`ops/security/s3-account-deletion-lifecycle-rule.example.json`.

Do not apply that file as a complete bucket lifecycle configuration. Read the
existing configuration, merge this rule by `ID`, review the combined rules,
and then update the bucket. Replacing the complete configuration would delete
unrelated lifecycle rules.

For a versioned bucket, both current and noncurrent versions must expire. The
example includes both settings.

`ops/security/s3-images-lifecycle.production.json` is the complete reviewed
production configuration. It preserves the existing multipart and noncurrent
version rules while adding the temporary-upload and account-deletion rules.
The tag-filtered account-deletion rule intentionally has no
`AbortIncompleteMultipartUpload` action; the bucket-wide one-day rule already
covers incomplete uploads, and S3 does not permit that action with a tag filter.

## IAM

The API task role needs only these account-deletion permissions:

- `s3:GetObjectTagging` on `S3_BUCKET_IMAGES/saved/*`
- `s3:PutObjectTagging` on `S3_BUCKET_IMAGES/saved/*`
- `cognito-idp:AdminDisableUser` on the production user pool
- `cognito-idp:AdminDeleteUser` on the production user pool

It does not need `s3:DeleteObject` for the account-deletion flow.

`ops/security/iam-api-runtime.production.json` is the complete production API
task-role policy. Its account-deletion statements are scoped to `saved/*` and
the single production Cognito pool.

## Verification

1. Create a disposable personal account and confirmed image.
2. Start deletion and confirm that the object receives the pending tag.
3. Confirm that personal DB data is anonymized and the Cognito identity is
   disabled/deleted.
4. After the lifecycle interval, confirm that current and noncurrent object
   versions are gone.
5. Retry the deletion request and confirm that no duplicate provider action or
   credit/ledger mutation occurs.
