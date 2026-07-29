# Mobile API Audit A

監査日: 2026-07-25

対象: `apps/mobile/src/lib/api.ts` の `LyraMobileApiClient` public method

根拠: `docs/mobile_completion_gap_spec.md` 7章、14章 Audit A、`MOB-API-001`

## 判定

**Pass**

- public method: **112**
- Backend route特定済み: **112**
- 未分類route: **0**
- canonical response contract適用対象: **98**（JSON 96、SSE method 2）
- production routeで`assertMobileResponseContract`適用済み: **98**
- response validator残差: **0**
- response contract N/A: **14**（204 response 11、binary response 3）
- Mobile production sourceから直接呼ばれるmethod: **91**
- 直接呼ばれないclient method: **21**

全methodにBackend route、auth、organization scope、Backend request validator、Mobile canonical response schemaを割り当てた。JSON/SSE response 98件はproduction routeでcanonical schema検証済みで、bodyを持たない204 response 11件とbinary response 3件だけをN/Aとしている。

## 凡例

- Auth `A`: authenticated user + rate limit。
- Auth `P`: public read + public rate limit。
- Org `OQ`: optional `organization_id` query。未指定時はpersonal ownership。
- Org `OP`: organization ID path parameter。
- Org `OB`: `organization_id` request body。
- Org `Personal`: organization scopeを受け付けない個人account endpoint。
- Org `Global`: authenticatedだがworkspaceに属さないcatalog/config endpoint。
- Assert `Yes`: production routeが送信前に`assertMobileResponseContract`を実行。
- Assert `No`: production routeがcanonical response schemaをimportしていても、該当responseの送信前検証がない。
- Assert `N/A`: JSON bodyがなく、canonical JSON response contractの対象外。
- 導線 `No direct call`: `apps/mobile/src`で`.methodName(`形式のproduction callがない。client API surfaceとしては存在する。

Request欄はBackendの実行時validator名である。Mobile側のpayloadは`apps/mobile/src/domain/payloads.ts`等のTypeScript型であり、request schemaは共有package化されていない。Response欄は`packages/api-contract/src/mobileApiSchemas.ts`由来である。

## Method inventory

| # | Mobile method | HTTP method / path | Backend route | Auth | Org | Request validator | Canonical response | Assert | Mobile導線 / 対象外 |
|---:|---|---|---|:---:|:---:|---|---|:---:|---|
| 001 | `getCurrentSession` | `GET /api/me` | `src/routes/me.ts` | A | Personal | none | `currentSessionSchema` | Yes | `App`, `Account`, store billing bridge |
| 002 | `getEntityReferenceGenerationAvailability` | `GET /api/entities/reference-generation-availability` | `src/routes/entities.ts` | A | Global | none | `entityReferenceGenerationAvailabilitySchema` | Yes | `Characters` |
| 003 | `getMobilePurchaseBinding` | `GET /api/mobile-purchases/binding` | `src/routes/mobilePurchases.ts` | A | Personal | none | `mobilePurchaseAccountBindingSchema` | Yes | store billing bridge |
| 004 | `getMobileStoreProductCatalog` | `GET /api/mobile-purchases/catalog/:store` | `src/routes/mobilePurchases.ts` | A | Personal | `z.enum(STORE_PURCHASE_STORES)` | `mobileStoreProductCatalogSchema` | Yes | `Account` |
| 005 | `verifyAppleMobilePurchase` | `POST /api/mobile-purchases/apple/verify` | `src/routes/mobilePurchases.ts` | A | Personal | `mobileAppleVerifyBodySchema` | `mobileStorePurchaseResultSchema` | Yes | store billing bridge |
| 006 | `verifyGoogleMobilePurchase` | `POST /api/mobile-purchases/google/verify` | `src/routes/mobilePurchases.ts` | A | Personal | `mobileGoogleVerifyBodySchema` | `mobileStorePurchaseResultSchema` | Yes | store billing bridge |
| 007 | `restoreMobilePurchases` | `POST /api/mobile-purchases/restore` | `src/routes/mobilePurchases.ts` | A | Personal | `mobileRestoreBodySchema` | `mobileStoreRestoreResultSchema` | Yes | store billing bridge |
| 008 | `previewOrganizationInvitation` | `GET /api/organization-invitations/:token` | effective: `src/app.ts`; duplicate: `src/routes/organizations.ts` | P | none | `acceptInvitationBodySchema` | `organizationInvitationPreviewSchema` | Yes | `Invitation` |
| 009 | `acceptOrganizationInvitation` | `POST /api/organization-invitations/accept` | `src/routes/organizations.ts` | A | token | `acceptInvitationBodySchema` | `organizationWorkspaceSchema` | Yes | `Invitation` |
| 010 | `createOrganization` | `POST /api/organizations` | `src/routes/organizations.ts` | A | new org | `createOrganizationBodySchema` | `organizationWorkspaceDetailSchema` | Yes | `Account` |
| 011 | `getOrganizationWorkspace` | `GET /api/organizations/:organizationId` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationWorkspaceDetailSchema` | Yes | organization management |
| 012 | `updateOrganization` | `PATCH /api/organizations/:organizationId` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` + `updateOrganizationBodySchema` | `organizationUpdateResponseSchema` | Yes | organization management |
| 013 | `getOrganizationMembers` | `GET /api/organizations/:organizationId/members` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationMembersResponseSchema` | Yes | No direct call; paged method used |
| 014 | `getOrganizationMembersPage` | `GET /api/organizations/:organizationId/members?limit&cursor` | `src/routes/organizations.ts` | A | OP | UUID + list page parser | `organizationMembersResponseSchema` | Yes | organization management |
| 015 | `updateOrganizationMember` | `PATCH /api/organizations/:organizationId/members/:memberId` | `src/routes/organizations.ts` | A | OP | UUID + `updateOrganizationMemberBodySchema` | `organizationMemberUpdateResponseSchema` | Yes | organization management |
| 016 | `removeOrganizationMember` | `DELETE /api/organizations/:organizationId/members/:memberId` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | N/A, 204 | N/A | organization management |
| 017 | `getOrganizationInvitations` | `GET /api/organizations/:organizationId/invitations` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationInvitationsResponseSchema` | Yes | No direct call; paged method used |
| 018 | `getOrganizationInvitationsPage` | `GET /api/organizations/:organizationId/invitations?limit&cursor` | `src/routes/organizations.ts` | A | OP | UUID + list page parser | `organizationInvitationsResponseSchema` | Yes | organization management |
| 019 | `createOrganizationInvitation` | `POST /api/organizations/:organizationId/invitations` | `src/routes/organizations.ts` | A | OP | UUID + `createOrganizationInvitationBodySchema` | `organizationInvitationActionResponseSchema` | Yes | organization management |
| 020 | `resendOrganizationInvitation` | `POST /api/organizations/:organizationId/invitations/:invitationId/resend` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationInvitationActionResponseSchema` | Yes | organization management |
| 021 | `revokeOrganizationInvitation` | `POST /api/organizations/:organizationId/invitations/:invitationId/revoke` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationInvitationUpdateResponseSchema` | Yes | organization management |
| 022 | `getOrganizationCreditBalance` | `GET /api/organizations/:organizationId/credits/balance` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationCreditBalanceSchema` | Yes | No direct call |
| 023 | `getOrganizationPlans` | `GET /api/organizations/:organizationId/billing/plans` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationPlansResponseSchema` | Yes | No direct call |
| 024 | `getOrganizationBillingSummary` | `GET /api/organizations/:organizationId/billing` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationBillingSummarySchema` | Yes | organization management |
| 025 | `createOrganizationSubscriptionCheckout` | `POST /api/organizations/:organizationId/billing/checkout/subscription` | `src/routes/organizations.ts` | A | OP | UUID + `organizationBillingCheckoutBodySchema` | `organizationSubscriptionCheckoutSchema` | Yes | organization management |
| 026 | `createOrganizationCreditCheckout` | `POST /api/organizations/:organizationId/billing/checkout/credits` | `src/routes/organizations.ts` | A | OP | UUID + `organizationCreditCheckoutBodySchema` | `organizationCreditCheckoutSchema` | Yes | organization management |
| 027 | `createOrganizationCustomerPortal` | `POST /api/organizations/:organizationId/billing/customer-portal` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationCustomerPortalSchema` | Yes | organization management |
| 028 | `getOrganizationInvoices` | `GET /api/organizations/:organizationId/invoices` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationInvoicesResponseSchema` | Yes | organization management |
| 029 | `getOrganizationUsage` | `GET /api/organizations/:organizationId/usage` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationUsageResponseSchema` | Yes | No direct call; paged method used |
| 030 | `getOrganizationUsagePage` | `GET /api/organizations/:organizationId/usage?limit&cursor` | `src/routes/organizations.ts` | A | OP | UUID + list page parser | `organizationUsageResponseSchema` | Yes | organization management |
| 031 | `getOrganizationAuditLogs` | `GET /api/organizations/:organizationId/audit-logs` | `src/routes/organizations.ts` | A | OP | `organizationUuidParamSchema` | `organizationAuditLogsResponseSchema` | Yes | No direct call; paged method used |
| 032 | `getOrganizationAuditLogsPage` | `GET /api/organizations/:organizationId/audit-logs?limit&cursor` | `src/routes/organizations.ts` | A | OP | UUID + list page parser | `organizationAuditLogsResponseSchema` | Yes | organization management |
| 033 | `getWorks` | `GET /api/works?organization_id` | `src/routes/story.ts` | A | OQ | `workPageQuerySchema` | `worksResponseSchema` | Yes | No direct call; paged method used |
| 034 | `getWorksPage` | `GET /api/works?organization_id&limit&cursor` | `src/routes/story.ts` | A | OQ | `workPageQuerySchema` | `worksResponseSchema` | Yes | workspace picker, `Story` |
| 035 | `getWork` | `GET /api/works/:id?organization_id` | `src/routes/story.ts` | A | OQ | `storyUuidParamSchema` | `workSchema` | Yes | hierarchy/workspace picker/`Story` |
| 036 | `createWork` | `POST /api/works` | `src/routes/story.ts` | A | OB | `createWorkBodySchema` | `workSchema` | Yes | hierarchy |
| 037 | `updateWork` | `PUT /api/works/:id?organization_id` | `src/routes/story.ts` | A | OQ | UUID + `updateWorkBodySchema` | `workSchema` | Yes | hierarchy, `Story` |
| 038 | `getChapters` | `GET /api/works/:id/chapters?organization_id` | `src/routes/story.ts` | A | OQ | `storyUuidParamSchema` | `chaptersResponseSchema` | Yes | hierarchy/workspace picker/`Story` |
| 039 | `createChapter` | `POST /api/works/:id/chapters?organization_id` | `src/routes/story.ts` | A | OQ | UUID + `createChapterBodySchema` | `chapterSchema` | Yes | hierarchy |
| 040 | `updateChapter` | `PUT /api/chapters/:id?organization_id` | `src/routes/story.ts` | A | OQ | UUID + `updateChapterBodySchema` | `chapterSchema` | Yes | hierarchy, `Story` |
| 041 | `moveChapter` | `POST /api/chapters/:id/move?organization_id` | `src/routes/story.ts` | A | OQ | UUID + `moveStoryItemBodySchema` | `chapterSchema` | Yes | hierarchy |
| 042 | `deleteChapter` | `DELETE /api/chapters/:id?organization_id` | `src/routes/story.ts` | A | OQ | `storyUuidParamSchema` | N/A, 204 | N/A | hierarchy |
| 043 | `getEpisodes` | `GET /api/chapters/:id/episodes?organization_id` | `src/routes/story.ts` | A | OQ | `storyUuidParamSchema` | `episodesResponseSchema` | Yes | hierarchy/workspace picker/`Story` |
| 044 | `createEpisode` | `POST /api/chapters/:id/episodes?organization_id` | `src/routes/story.ts` | A | OQ | UUID + `createEpisodeBodySchema` | `episodeSchema` | Yes | hierarchy |
| 045 | `updateEpisode` | `PUT /api/episodes/:id?organization_id` | `src/routes/story.ts` | A | OQ | UUID + `updateEpisodeBodySchema` | `episodeSchema` | Yes | hierarchy, `Story` |
| 046 | `moveEpisode` | `POST /api/episodes/:id/move?organization_id` | `src/routes/story.ts` | A | OQ | UUID + `moveStoryItemBodySchema` | `episodeSchema` | Yes | hierarchy |
| 047 | `deleteEpisode` | `DELETE /api/episodes/:id?organization_id` | `src/routes/story.ts` | A | OQ | `storyUuidParamSchema` | N/A, 204 | N/A | hierarchy |
| 048 | `generatePageSkeleton` | `POST /api/episodes/:id/generate-page-skeleton?organization_id` | `src/routes/story.ts` | A | OQ | `generatePageSkeletonParamSchema` + `generatePageSkeletonBodySchema` | `pageSkeletonResponseSchema` | Yes | `Story`, `Account` job recovery |
| 049 | `improveEpisodeDraft` | `POST /api/story/improve-episode-draft?organization_id` | `src/routes/story.ts` | A | OQ | `improveEpisodeDraftBodySchema` | `storyEpisodeImprovementSchema` | Yes | `Story` |
| 050 | `collaborateStory` | `POST /api/story/collaborate?organization_id` | `src/routes/story.ts` | A | OQ | `collaborateStoryBodySchema` | `storyCollaborationEventSchema` SSE | Yes, event | No direct call; aggregate wrapper |
| 051 | `streamStoryCollaboration` | `POST /api/story/collaborate?organization_id` | `src/routes/story.ts` | A | OQ | `collaborateStoryBodySchema` | `storyCollaborationEventSchema` SSE | Yes, event | No direct call |
| 052 | `getEntities` | `GET /api/works/:work_id/entities?organization_id` | `src/routes/entities.ts` | A | OQ | `uuidParamSchema` | `entitiesResponseSchema` | Yes | No direct call; paged method used |
| 053 | `getEntitiesPage` | `GET /api/works/:work_id/entities?organization_id&limit&cursor` | `src/routes/entities.ts` | A | OQ | UUID + `entityPageQuerySchema` | `entitiesResponseSchema` | Yes | `Characters`, `Pages`, `Story` |
| 054 | `getEntity` | `GET /api/entities/:id?organization_id` | `src/routes/entities.ts` | A | OQ | `uuidParamSchema` | `entitySchema` | Yes | `Characters` |
| 055 | `createEntity` | `POST /api/works/:work_id/entities?organization_id` | `src/routes/entities.ts` | A | OQ | UUID + `createEntityBodySchema` | `entitySchema` | Yes | `Characters` |
| 056 | `updateEntity` | `PUT /api/entities/:id?organization_id` | `src/routes/entities.ts` | A | OQ | UUID + `updateEntityBodySchema` | `entitySchema` | Yes | `Characters` |
| 057 | `deleteEntity` | `DELETE /api/entities/:id?organization_id` | `src/routes/entities.ts` | A | OQ | `uuidParamSchema` | N/A, 204 | N/A | `Characters` |
| 058 | `importEntityImage` | `POST /api/entities/import-image?organization_id` | `src/routes/entities.ts` | A | OQ | `importEntityImageBodySchema` | `entityImportResponseSchema` | Yes | `Characters` |
| 059 | `createEntityReferenceUpload` | `POST /api/uploads/entity-reference/presign?organization_id` | `src/routes/entityReferenceUploads.ts` | A | OQ | `entityReferenceUploadPresignBodySchema` | `entityReferenceUploadPresignResponseSchema` | Yes | `Characters` |
| 060 | `generateEntityReference` | `POST /api/entities/:id/generate-reference?organization_id` | `src/routes/entities.ts` | A | OQ | UUID + `generateEntityReferenceBodySchema` | `jobAcceptedSchema` | Yes | `Characters`, `Account` job recovery |
| 061 | `getEntityReferenceSet` | `GET /api/entities/:id/reference-set?organization_id` | `src/routes/entities.ts` | A | OQ | `uuidParamSchema` | `entityReferenceSetSchema` | Yes | `Characters` |
| 062 | `confirmEntityReference` | `POST /api/entities/:id/reference/confirm?organization_id` | `src/routes/entities.ts` | A | OQ | UUID + `confirmEntityReferenceBodySchema` | `entityReferenceSetSchema` | Yes | `Characters` |
| 063 | `deleteEntityReference` | `DELETE /api/entities/:id/reference/:ref_id?organization_id` | `src/routes/entities.ts` | A | OQ | `uuidParamSchema` + `referenceIdParamSchema` | `entityReferenceSetSchema` | Yes | `Characters` |
| 064 | `getEntityStates` | `GET /api/entities/:id/states?organization_id` | `src/routes/scenes.ts` | A | OQ | `sceneUuidParamSchema` | `entityStatesResponseSchema` | Yes | `Characters`, `Pages` |
| 065 | `createEntityState` | `POST /api/entities/:id/states?organization_id` | `src/routes/scenes.ts` | A | OQ | UUID + `createEntityStateBodySchema` | `entityStateSchema` | Yes | `Characters` |
| 066 | `updateEntityState` | `PUT /api/entities/:id/states/:state_id?organization_id` | `src/routes/scenes.ts` | A | OQ | UUID + `updateEntityStateBodySchema` | `entityStateSchema` | Yes | `Characters` |
| 067 | `getScenes` | `GET /api/episodes/:id/scenes?organization_id` | `src/routes/scenes.ts` | A | OQ | `sceneUuidParamSchema` | `scenesResponseSchema` | Yes | `Characters`, `Pages`, `Story` |
| 068 | `createScene` | `POST /api/episodes/:id/scenes?organization_id` | `src/routes/scenes.ts` | A | OQ | UUID + `createSceneBodySchema` | `sceneSchema` | Yes | `Story` |
| 069 | `updateScene` | `PUT /api/scenes/:id?organization_id` | `src/routes/scenes.ts` | A | OQ | UUID + `updateSceneBodySchema` | `sceneSchema` | Yes | `Story` |
| 070 | `deleteScene` | `DELETE /api/scenes/:id?organization_id` | `src/routes/scenes.ts` | A | OQ | `sceneUuidParamSchema` | N/A, 204 | N/A | `Story` |
| 071 | `getPages` | `GET /api/episodes/:id/pages?organization_id` | `src/routes/pages.ts` | A | OQ | `uuidParamSchema` | `pagesResponseSchema` | Yes | No direct call; paged method used |
| 072 | `getPagesPage` | `GET /api/episodes/:id/pages?organization_id&limit&cursor` | `src/routes/pages.ts` | A | OQ | UUID + `pageListQuerySchema` | `pagesResponseSchema` | Yes | `Pages`, `Story` |
| 073 | `getPage` | `GET /api/pages/:id?organization_id` | `src/routes/pages.ts` | A | OQ | `uuidParamSchema` | `pageSchema` | Yes | `Pages` |
| 074 | `createEpisodeExport` | `POST /api/episodes/:episodeId/exports?organization_id` | `src/routes/exports.ts` | A | OQ | `createEpisodeExportBodySchema` + `exportIdempotencyKeySchema` | `createEpisodeExportResponseSchema` | Yes | `Pages` |
| 075 | `getExportJob` | `GET /api/exports/:jobId?organization_id` | `src/routes/exports.ts` | A | OQ | `uuidSchema` | `exportJobSchema` | Yes | export job card |
| 076 | `updatePage` | `PUT /api/pages/:id?organization_id` | `src/routes/pages.ts` | A | OQ | UUID + `updatePageSettingsBodySchema` | `pageSchema` | Yes | `Pages` |
| 077 | `getPageGenerationReadiness` | `GET /api/pages/:id/generation-readiness?organization_id` | `src/routes/pages.ts` | A | OQ | `uuidParamSchema` | `pageGenerationReadinessSchema` | Yes | `Pages` |
| 078 | `saveAndGeneratePage` | `POST /api/pages/:id/save-and-generate?organization_id` | `src/routes/pages.ts` | A | OQ | `saveAndGeneratePageBodySchema` + idempotency header check | `saveAndGeneratePageResponseSchema` | Yes | `Pages` |
| 079 | `getPageLayoutTemplates` | `GET /api/page-layout-templates` | `src/routes/pages.ts` | A | Global | none | `pageLayoutTemplatesResponseSchema` | Yes | `Pages` |
| 080 | `autofillEpisodePagesFromStory` | `POST /api/episodes/:id/autofill-pages-from-story?organization_id` | `src/routes/pages.ts` | A | OQ | UUID + `languageBodySchema` | `jobAcceptedSchema` | Yes | `Story`, `Account` job recovery |
| 081 | `autofillPageFromScenes` | `POST /api/pages/:id/autofill-from-scenes?organization_id` | `src/routes/pages.ts` | A | OQ | UUID + `languageBodySchema` | `pageAutofillResponseSchema` | Yes | No direct call; optional advanced action |
| 082 | `generatePage` | `POST /api/pages/:id/generate?organization_id` | `src/routes/pages.ts` | A | OQ | `uuidParamSchema` | `jobAcceptedSchema` | Yes | No direct call; atomic method used |
| 083 | `confirmPage` | `POST /api/pages/:id/confirm?organization_id` | `src/routes/pages.ts` | A | OQ | `uuidParamSchema` | N/A, 204 | N/A | `Pages` |
| 084 | `reopenPage` | `POST /api/pages/:id/reopen?organization_id` | `src/routes/pages.ts` | A | OQ | `uuidParamSchema` | N/A, 204 | N/A | `Pages` |
| 085 | `getPanels` | `GET /api/pages/:id/panels?organization_id` | `src/routes/panels.ts` | A | OQ | `panelUuidParamSchema` | `panelsResponseSchema` | Yes | `Pages` |
| 086 | `createPanel` | `POST /api/pages/:id/panels?organization_id` | `src/routes/panels.ts` | A | OQ | UUID + `createPanelBodySchema` | `panelSchema` | Yes | `Pages` |
| 087 | `updatePanel` | `PUT /api/panels/:id?organization_id` | `src/routes/panels.ts` | A | OQ | UUID + `updatePanelBodySchema` | `panelSchema` | Yes | `Pages` |
| 088 | `deletePanel` | `DELETE /api/panels/:id?organization_id` | `src/routes/panels.ts` | A | OQ | `panelUuidParamSchema` | N/A, 204 | N/A | `Pages` |
| 089 | `reorderPanels` | `PUT /api/pages/:id/panels/order?organization_id` | `src/routes/panels.ts` | A | OQ | UUID + `reorderPanelsBodySchema` | `panelsResponseSchema` | Yes | `Pages` |
| 090 | `replacePanelAssignments` | `PUT /api/panels/:id/entities?organization_id` | `src/routes/panelEntityAssignments.ts` | A | OQ | UUID + `replacePanelEntityAssignmentsBodySchema` | `panelAssignmentsResponseSchema` | Yes | `Pages` |
| 091 | `getFrames` | `GET /api/pages/:id/frames?organization_id` | `src/routes/panelFrames.ts` | A | OQ | `panelFrameUuidParamSchema` | `framesResponseSchema` | Yes | `Pages` |
| 092 | `applyPageLayoutTemplate` | `POST /api/pages/:id/layout-template?organization_id` | `src/routes/pages.ts` | A | OQ | UUID + `applyPageLayoutTemplateBodySchema` | `layoutTemplateResponseSchema` | Yes | `Pages` |
| 093 | `applyFrameTemplate` | `POST /api/pages/:id/frames/apply-template?organization_id` | `src/routes/panelFrames.ts` | A | OQ | UUID + `applyPanelFrameTemplateBodySchema` | `frameTemplateResponseSchema` | Yes | `Pages` |
| 094 | `replaceFrames` | `PUT /api/pages/:id/frames?organization_id` | `src/routes/panelFrames.ts` | A | OQ | UUID + `replacePanelFramesBodySchema` | `framesResponseSchema` | Yes | `Pages` |
| 095 | `getBalloons` | `GET /api/pages/:id/balloons?organization_id` | `src/routes/balloons.ts` | A | OQ | `balloonUuidParamSchema` | `balloonsResponseSchema` | Yes | 対象外: 現行Mobile UIで非表示 |
| 096 | `createBalloon` | `POST /api/pages/:id/balloons?organization_id` | `src/routes/balloons.ts` | A | OQ | UUID + `createBalloonBodySchema` | `balloonSchema` | Yes | 対象外: 現行Mobile UIで非表示 |
| 097 | `updateBalloon` | `PUT /api/balloons/:id?organization_id` | `src/routes/balloons.ts` | A | OQ | UUID + `updateBalloonBodySchema` | `balloonSchema` | Yes | 対象外: 現行Mobile UIで非表示 |
| 098 | `deleteBalloon` | `DELETE /api/balloons/:id?organization_id` | `src/routes/balloons.ts` | A | OQ | `balloonUuidParamSchema` | N/A, 204 | N/A | 対象外: 現行Mobile UIで非表示 |
| 099 | `autoBalloons` | `POST /api/pages/:id/auto-balloons?organization_id` | `src/routes/balloons.ts` | A | OQ | `balloonUuidParamSchema` | `balloonsResponseSchema` | Yes | 対象外: 現行Mobile UIで非表示 |
| 100 | `getCompositions` | `GET /api/compositions` | `src/routes/compositions.ts` | A | Global | none | `compositionsResponseSchema` | Yes | `Pages` |
| 101 | `exportPageImage` | `GET /api/pages/:id/export-image?organization_id` | `src/routes/pages.ts` | A | OQ | `uuidParamSchema` | N/A, binary image | N/A | No direct call |
| 102 | `exportEntityReferenceImage` | `GET /api/entities/:id/reference/:ref_id/image?organization_id` | `src/routes/entities.ts` | A | OQ | UUID + `referenceIdParamSchema` | N/A, binary image | N/A | No direct call |
| 103 | `exportEntityReferenceCandidateImage` | `GET /api/entities/:id/reference-candidate-image?candidate_token&organization_id` | `src/routes/entities.ts` | A | OQ | UUID + `referenceCandidateImageQuerySchema` | N/A, binary image | N/A | No direct call |
| 104 | `getJob` | `GET /api/jobs/:id?organization_id` | `src/routes/jobs.ts` | A | OQ | `uuidParamSchema` | `generationJobSchema` | Yes | job card/push navigation/`Characters` |
| 105 | `listJobs` | `GET /api/jobs?organization_id&limit&cursor&status&type` | `src/routes/jobs.ts` | A | OQ | `parseJobListQuery` + UUID/cursor checks | `generationJobsResponseSchema` | Yes | active job hook, `Account` |
| 106 | `cancelJob` | `POST /api/jobs/:id/cancel?organization_id` | `src/routes/jobs.ts` | A | OQ | `uuidParamSchema` | `generationJobSchema` | Yes | `Account`, `Story` |
| 107 | `hideJob` | `DELETE /api/jobs/:id?organization_id` | `src/routes/jobs.ts` | A | OQ | `uuidParamSchema` | N/A, 204 | N/A | `Account` |
| 108 | `registerPushToken` | `POST /api/push-tokens` | `src/routes/pushTokens.ts` | A | Personal | `pushTokenRegistrationBodySchema` | `pushTokenRegistrationSchema` | Yes | push notification coordinator |
| 109 | `removePushToken` | `DELETE /api/push-tokens/:installationId` | `src/routes/pushTokens.ts` | A | Personal | `pushTokenInstallationIdSchema` | N/A, 204 | N/A | push notification coordinator |
| 110 | `getAccountDeletionPreview` | `GET /api/account/deletion-preview` | `src/routes/account.ts` | A | Personal | none | `accountDeletionPreviewSchema` | Yes | `Account` |
| 111 | `requestAccountDeletion` | `POST /api/account/deletion` | `src/routes/account.ts` | A | Personal | `accountDeletionRequestSchema` | `accountDeletionResultSchema` | Yes | `Account` |
| 112 | `getBalance` | `GET /api/billing/balance` | `src/routes/billing.ts` | A | Personal | none | `billingBalanceSchema` | Yes | `Account`, store billing bridge |

## Response validator残差

なし。旧R-01からR-08の24 responseはすべてproduction routeでcanonical schema検証済み。

## Direct-call残差

次の21 methodはMobile production sourceから直接呼ばれない。Backend routeは全件特定済みなので「未分類route」には数えない。

`getOrganizationMembers`, `getOrganizationInvitations`, `getOrganizationCreditBalance`, `getOrganizationPlans`, `getOrganizationUsage`, `getOrganizationAuditLogs`, `getWorks`, `collaborateStory`, `streamStoryCollaboration`, `getEntities`, `getPages`, `autofillPageFromScenes`, `generatePage`, `getBalloons`, `createBalloon`, `updateBalloon`, `deleteBalloon`, `autoBalloons`, `exportPageImage`, `exportEntityReferenceImage`, `exportEntityReferenceCandidateImage`

このうちunpaged list methodはpaged methodへの移行用互換surface、balloon methodは仕様上UI非表示である。残りは将来導線かdead surfaceかをAudit B/Cで判断する。

## 機械抽出と照合方法

### 1. public method抽出

TypeScript compiler APIで`LyraMobileApiClient`の`MethodDeclaration`を列挙し、`private` methodとconstructorを除外した。

```powershell
@'
const fs = require('fs');
const ts = require('typescript');
const path = 'apps/mobile/src/lib/api.ts';
const source = fs.readFileSync(path, 'utf8');
const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const client = file.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'LyraMobileApiClient'
);
const methods = client.members.filter(ts.isMethodDeclaration).filter(
  (method) => !method.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)
);
console.log(methods.length);
'@ | node -
```

結果: `112`

### 2. routeとassert抽出

```powershell
rg -n "\.(get|post|put|patch|delete)\(" src/routes src/app.ts
rg -n "assertMobileResponseContract" src/routes
rg -n "safeParse|BodySchema|QuerySchema|ParamSchema" src/routes
```

各method内の`request`、`requestVoid`、`fetchWithAuthRetry`、`stream`の第1引数をHTTP routeへ正規化し、上記route一覧と照合した。112 methodすべてに対応routeがあり、表の連番`001`から`112`まで欠番はない。

### 3. Mobile導線抽出

`apps/mobile/src/lib/api.ts`を除いた`apps/mobile/src/**/*.{ts,tsx}`を対象に、各methodの正規表現 `\.\s*methodName\s*\(` を照合した。

結果:

- direct callあり: `91`
- direct callなし: `21`
- 合計: `112`

### 4. 表件数の照合

```powershell
rg -c "^\| [0-9]{3} \|" docs/mobile_api_audit.md
```

期待値: `112`

## Audit A完了根拠

1. 旧R-01からR-08の24 responseをproduction routeでcanonical schema検証した。
2. `assertMobileResponseContract`はschemaのparse結果へresponseを置換せず、元のwire payloadを返す。
3. 112 methodすべてにrouteとrequest/response schemaを割り当て、未分類route 0、response validator残差 0を確認した。
4. request/response DTOは`packages/api-contract`からMobileへ生成し、Mobile境界でもschema parseしている。
