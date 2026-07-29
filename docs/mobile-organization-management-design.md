# Mobile Organization Management Design

## Scope

`OrganizationManagementPanel` is a reusable Mobile-only panel for the currently
selected organization workspace. It does not select a workspace and does not
accept a free-form organization ID from UI input. Its caller must derive the
organization record from the authenticated `/api/me` session selection.

## Contract and tenancy

- Every organization resource uses `/api/organizations/:organizationId/...`.
- The Mobile API client runtime-parses each JSON response with Zod.
- Backend organization endpoints do not expose cursor fields. Members and
  invitations currently return their full server-side lists; invoices are capped
  at 100; usage and audit records are capped at 200. The panel renders the
  returned records as-is and does not invent a `cursor` or hide server data.
- Checkout and customer-portal URLs are only browser handoffs. They never mark
  payment successful; callers must refresh backend billing state after return.

## Authorization model

The panel uses the session role only to decide which controls and sections are
available. Backend authorization remains authoritative.

- owner: workspace settings, members, billing, usage, and audit
- admin: members, usage, and audit
- billing: billing and billing-limited audit history
- editor/viewer: workspace summary only

Destructive member removal is delegated to the caller through a mandatory
confirmation callback. The panel never exposes invitation URLs, tokens,
provider error text, raw metadata, or raw identifiers as normal labels.

## Tests

API contract tests cover scoped paths, runtime rejection of malformed data, and
the checkout handoff response. Component tests cover role-specific controls,
safe labels, and the remove-confirmation callback.
