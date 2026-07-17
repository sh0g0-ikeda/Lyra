# Innovation Cup repository presentation design

## Purpose and scope

Prepare Lyra's public repository for a short, English-first hackathon review.
The work is limited to repository presentation, public documentation, security
reporting guidance, and public-information auditing.

This change does not modify application behavior, APIs, database contracts,
authentication, authorization, billing, generation jobs, or AWS resources. It
does not create fictional screenshots, metrics, awards, customers, or product
claims.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md` section 2 defines the product boundary and
  end-to-end production flow described in the README.
- Section 3 defines the architecture boundaries used by the diagrams and
  repository map.
- Sections 4 through 9 constrain authentication, tenancy, billing, generation,
  safety, and availability claims.
- Section 10 defines the verification commands documented for contributors.

## Affected layers and interfaces

- Public documentation: `README.md`, `SECURITY.md`, and the repository's
  licensing notice.
- Reviewer assets: `docs/assets/README_ASSETS_REQUIRED.md` documents the real
  screenshots still required from the running product.
- GitHub presentation: CI badge, repository links, and PR metadata guidance.

There are no runtime inputs, outputs, persistence changes, external API calls,
or job-contract changes.

## Information architecture

1. English product identity, CI state, OGP image, and concise value statement.
2. Demo-first links and the developer's role.
3. Problem, objective differentiation, and product walkthrough.
4. Story compilation pipeline before infrastructure details.
5. Features and reviewer evaluation points with English summaries.
6. System architecture, stack, repository structure, setup, and verification.
7. Security reporting, source-availability notice, and operational caveats.
8. Existing Japanese explanation remains available and technically detailed.

## Security and accuracy controls

- Never include credential values, private endpoints, account IDs, or customer
  data in the README, security policy, commit message, or PR description.
- Classify public identifiers and placeholders separately from usable secrets.
- Do not delete production configuration merely because it appears in public
  documentation; recommend private relocation where appropriate.
- Describe only behavior supported by the maintained specification, routes,
  services, package files, and tests.
- Do not add an open-source license. Use an explicit no-license-grant notice for
  portfolio and technical-review availability.
- Keep vulnerability reports out of public issues and avoid promising an SLA.

## Verification plan

This is documentation-only, so a new failing application test would not test
the changed behavior. Verification covers:

- local Markdown links and image targets;
- Mermaid source structure and code-fence balance;
- documented package scripts and technology versions;
- UTF-8 integrity and `git diff --check`;
- dependency installation and the repository's existing CI commands where the
  local environment permits them.

Commands that require a running PostgreSQL service, browser dependencies, or
external infrastructure must be reported honestly if unavailable.

## Sol/Terra delegation

- Sol owns information architecture, final claims, edits, integration,
  verification, commits, and the pull request.
- A read-only Terra audit checks public security exposure without reporting
  secret values.
- A separate read-only Terra audit checks assets, package scripts, stack
  versions, links, and README accuracy.
- Neither Terra task may edit files or perform production operations.
