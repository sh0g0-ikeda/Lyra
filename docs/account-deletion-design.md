# Account deletion design

## Scope

`POST /api/account/deletion` is an authenticated, explicitly confirmed account-deletion request. The caller can only operate on the user established by the authentication middleware; no user ID is accepted from the request body.

## Preconditions

The service returns a structured blocker before any external operation when the user is the sole active owner of an organization. Personal subscriptions and confirmed personal reference assets are reported as blockers until the caller explicitly acknowledges their cancellation/deletion.

## State and recovery

`account_deletion_requests` persists completed checkpoints for subscription cancellation, identity disable/delete, asset lifecycle scheduling, DB anonymization, and completion. A retry resumes from the first incomplete checkpoint. External ports must be idempotent; the Stripe implementation uses a stable idempotency key.

## Tenancy and data handling

Personal works (`organization_id IS NULL`) are deleted. Organization works, organization subscriptions, balances, and organization records are never selected for deletion. S3 deletion is limited to exact object keys found from the personal work graph; it never deletes a broad user prefix because existing keys can also contain organization-work assets. The user record remains as an anonymized foreign-key anchor while personal identifiers, display data, Stripe customer linkage, and personal memberships are removed.

## External operations

The existing Stripe adapter cancels personal subscriptions. Cognito administrative deletion and the S3 object lifecycle do not have existing production adapters in this repository. Their ports deliberately return `pending_external_action` until concrete adapters are configured; the API never reports completion or exposes a provider error in that state.
