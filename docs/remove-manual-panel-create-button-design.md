# Remove manual panel-create button design

## Purpose

The Pages editor exposed a `Create panel` button that created panel content
without creating a matching frame. Users reasonably interpreted it as adding a
new manga panel, but it could leave the page with different frame and panel
counts. Page generation correctly rejects that state.

## Scope

- Remove the normal Web UI entry point for creating panel content only.
- Keep the backend panel creation API and existing data model unchanged for
  compatibility with older flows, tests, and internal tools.
- Keep panel editing, deleting, reordering, layout selection, and layout change
  flows unchanged.

## Safety

The generation invariant remains the same: each page must have matching frame
and panel counts before image generation. Users should change panel count
through the layout/panel-count controls that update frames and panels together.

This is a Web presentation change only. It does not affect routes, services,
repositories, credits, jobs, or persistence.

## Verification

- Web lint
- Web production build
- Backend TypeScript build
