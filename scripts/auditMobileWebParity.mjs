import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');

/**
 * Each Audit C item must retain evidence from the Web UI, Mobile UI, and either
 * the shared API contract or an explicitly justified Mobile-specific safety
 * improvement. Paths and markers are deliberately kept together so a renamed
 * UI or API cannot silently make this inventory stale.
 */
export const auditCRequirements = [
  {
    requirement: 'full story input',
    behavior: 'Episode-wide full-story drafts are saved before page planning and StoryAI apply actions.',
    web: [{
      path: 'apps/web/src/App.tsx',
      markers: ['label="Whole story draft"', "story_input_mode: 'full'"]
    }],
    mobile: [{
      path: 'apps/mobile/src/screens/StoryScreen.tsx',
      markers: ["story_input_mode: 'full',", 'persistKey="story:episode"']
    }],
    contract: sharedContract(
      'apps/web/src/lib/api.ts',
      'apps/mobile/src/lib/api.ts',
      ['public updateEpisode', '/api/episodes/${episodeId}${organizationQuery(organizationId)}']
    ),
    verification: [{
      path: 'apps/mobile/tests/storyWorkflow.test.ts',
      markers: ["story_input_mode: 'full'"]
    }]
  },
  {
    requirement: 'optional scene',
    behavior: 'Scenes remain optional episode context and can be created, edited, and removed independently of the full story.',
    web: [{
      path: 'apps/web/src/App.tsx',
      markers: ['api.createScene(', 'toCreateScenePayload']
    }],
    mobile: [{
      path: 'apps/mobile/src/screens/StoryScreen.tsx',
      markers: ['api.createScene(', 'api.deleteScene(']
    }],
    contract: sharedContract(
      'apps/web/src/lib/api.ts',
      'apps/mobile/src/lib/api.ts',
      ['public createScene', '/api/episodes/${episodeId}/scenes${organizationQuery(organizationId)}']
    ),
    verification: [{
      path: 'apps/mobile/tests/apiContract.test.ts',
      markers: ['client.deleteScene', '/api/scenes/11111111-1111-4111-8111-111111111111?organization_id=']
    }]
  },
  {
    requirement: 'story hierarchy',
    behavior: 'Works, chapters, and episodes retain selection, ordering, creation, rename, and deletion workflows.',
    web: [{
      path: 'apps/web/src/App.tsx',
      markers: ["api.moveChapter(chapter.id, 'up'", "api.moveEpisode(episode.id, 'up'"]
    }],
    mobile: [{
      path: 'apps/mobile/src/components/StoryHierarchySheet.tsx',
      markers: ["| 'moveChapter'", "| 'moveEpisode'", 'canMoveEpisodeInHierarchy']
    }],
    contract: sharedContract(
      'apps/web/src/lib/api.ts',
      'apps/mobile/src/lib/api.ts',
      ['public moveChapter', 'public moveEpisode']
    ),
    verification: [{
      path: 'apps/mobile/tests/StoryHierarchySheet.test.tsx',
      markers: ['expect(api.moveEpisode).toHaveBeenCalledWith']
    }]
  },
  {
    requirement: 'character free description/import/preview/confirm',
    behavior: 'Character descriptions support image import, generated preview selection, and explicit reference confirmation.',
    web: [{
      path: 'apps/web/src/App.tsx',
      markers: ['api.importEntityImage(', 'api.generateEntityReference(', 'api.confirmEntityReference(']
    }],
    mobile: [{
      path: 'apps/mobile/src/screens/CharactersScreen.tsx',
      markers: ['uploadAndImportEntityReference', 'api.generateEntityReference(', 'api.confirmEntityReference(']
    }],
    contract: sharedContract(
      'apps/web/src/lib/api.ts',
      'apps/mobile/src/lib/api.ts',
      ['public generateEntityReference', 'public confirmEntityReference']
    ),
    verification: [{
      path: 'apps/mobile/tests/characterLatestUiContract.test.ts',
      markers: ['import, description/save, and references in order']
    }]
  },
  {
    requirement: 'page style reference',
    behavior: 'Style-reference title and notes are editable independently from dialogue and persist in page data.',
    web: [{
      path: 'apps/web/src/App.tsx',
      markers: ['label="Style reference title"', 'label="Style reference notes"']
    }],
    mobile: [{
      path: 'apps/mobile/src/screens/PagesScreen.tsx',
      markers: ['style_reference: styleReferencePayload()', "persistKey=\"pages:style\""]
    }],
    contract: sharedContract(
      'apps/web/src/lib/api.ts',
      'apps/mobile/src/lib/api.ts',
      ['public updatePage', '/api/pages/${pageId}${organizationQuery(organizationId)}']
    ),
    verification: [{
      path: 'apps/mobile/tests/pageStyleCopy.test.ts',
      markers: ["expect(t('ja', 'styleReference'))", "expect(t('ja', 'styleReferenceNotes'))"]
    }]
  },
  {
    requirement: 'page provenance',
    behavior: 'Source scenes, page purpose, and continuity are visible and editable as page provenance.',
    web: [{
      path: 'apps/web/src/App.tsx',
      markers: ["translateUiString(uiLanguage, 'Source scenes')", 'label="Continuity note"', 'story_page_purpose']
    }],
    mobile: [{
      path: 'apps/mobile/src/components/PageProvenanceFields.tsx',
      markers: ['sourceSceneIds', 'onPagePurposeChange', 'onContinuityNoteChange']
    }],
    contract: sharedContract(
      'apps/web/src/lib/api.ts',
      'apps/mobile/src/lib/api.ts',
      ['public updatePage', '/api/pages/${pageId}${organizationQuery(organizationId)}']
    ),
    verification: [{
      path: 'apps/mobile/tests/PageProvenanceFields.test.tsx',
      markers: ['source scenesを解決済みラベルのread-only chipとして表示する']
    }]
  },
  {
    requirement: 'layout reading order/preview',
    behavior: 'The selected layout renders frame geometry and its reading order before applying it to panels.',
    web: [{
      path: 'apps/web/src/App.tsx',
      markers: ['await api.applyPageLayoutTemplate(', '<LayoutTemplatePreview frames={layoutPreviewFrames} />']
    }],
    mobile: [{
      path: 'apps/mobile/src/screens/PagesScreen.tsx',
      markers: ['<LayoutTemplatePreview', 'reading_order']
    }],
    contract: sharedContract(
      'apps/web/src/lib/api.ts',
      'apps/mobile/src/lib/api.ts',
      ['public applyPageLayoutTemplate', '/api/pages/${pageId}/layout-template${organizationQuery(organizationId)}']
    ),
    verification: [{
      path: 'apps/mobile/tests/pageSafety.test.ts',
      markers: ['createSafeLayoutTemplatePayload']
    }]
  },
  {
    requirement: 'panel reorder/delete',
    behavior: 'Panel order and destructive removal are adjacent to the ordered panel list and update the shared page order.',
    web: [{
      path: 'apps/web/src/App.tsx',
      markers: ['api.reorderPanels(', "translateUiString(uiLanguage, 'Move earlier')", "runAction('Delete panel'"]
    }],
    mobile: [{
      path: 'apps/mobile/src/components/PanelOrderList.tsx',
      markers: ["onMove(activePanel.id, direction)", 'onDelete(panel)', 'generated.components.PanelOrderList.move.earlier']
    }],
    contract: sharedContract(
      'apps/web/src/lib/api.ts',
      'apps/mobile/src/lib/api.ts',
      ['public reorderPanels', '/api/pages/${pageId}/panels/order${organizationQuery(organizationId)}']
    ),
    verification: [{
      path: 'apps/mobile/tests/PanelOrderList.test.tsx',
      markers: ['expect(onMove).toHaveBeenCalledWith', 'expect(onDelete).toHaveBeenCalledWith']
    }]
  },
  {
    requirement: 'generation blocker messages',
    behavior: 'Generation blockers explain why generation cannot proceed and expose a valid recovery action when one exists.',
    web: [{
      path: 'apps/web/src/App.tsx',
      markers: ["'Page generation is blocked until panel layout and panel content match.'", 'selectedPageHasFramePanelMismatch']
    }],
    mobile: [{
      path: 'apps/mobile/src/screens/PagesScreen.tsx',
      markers: ['api.getPageGenerationReadiness(', 'generationBlockerMessage(blocker, language)', 'handleGenerationBlockerAction(blocker)']
    }],
    contract: {
      kind: 'intentional-mobile-difference',
      reason: 'Mobile calls GET /api/pages/:id/generation-readiness before generation so it can show server-authoritative blocker codes and recovery actions. Web derives its equivalent layout/panel mismatch message locally; the Mobile preflight is an additional safety check, not a weaker contract.'
    },
    verification: [{
      path: 'apps/mobile/tests/EntityGenerationBlockers.test.tsx',
      markers: ['解決可能なblockerに該当sectionまたはAccountへのactionを出す', 'expect(onAction).toHaveBeenCalledWith']
    }]
  },
  {
    requirement: 'personal/org billing separation',
    behavior: 'Personal and organization balances, plans, and billing-management paths remain visibly and contractually separate.',
    web: [{
      path: 'apps/web/src/App.tsx',
      markers: ["'Personal credits are used.'", "'Organization billing'", 'activeOrganizationBalance']
    }],
    mobile: [{
      path: 'apps/mobile/src/screens/AccountScreen.tsx',
      markers: ['activeOrganization', '<PersonalBillingSummary', '<OrganizationManagementPanel']
    }],
    contract: {
      kind: 'shared-api',
      web: [{
        path: 'apps/web/src/lib/api.ts',
        markers: ['public getOrganizationBalance', '/api/organizations/${organizationId}/credits/balance']
      }],
      mobile: [{
        path: 'apps/mobile/src/lib/api.ts',
        markers: ['public getOrganizationCreditBalance', '/api/organizations/${encodeURIComponent(organizationId)}/credits/balance']
      }]
    },
    verification: [
      {
        path: 'apps/mobile/tests/AccountScreenOrganizationFeatures.test.tsx',
        markers: ['organization feature guard', 'organizationId: null']
      },
      {
        path: 'apps/mobile/tests/PersonalBillingSummary.test.tsx',
        markers: ['PersonalBillingSummary']
      }
    ]
  },
  {
    requirement: 'jobs/credits/tutorial',
    behavior: 'Job recovery, credit settlement, and the first-run tutorial are reachable in the Mobile product.',
    web: [{
      path: 'apps/web/src/App.tsx',
      markers: ['const tutorialSteps:', 'const trackedJobsStorageKey', "title=\"Credits\""]
    }],
    mobile: [
      {
        path: 'apps/mobile/src/components/JobStatusCard.tsx',
        markers: ['safeJobErrorMessage', 'onRetry']
      },
      {
        path: 'apps/mobile/src/screens/GuideScreen.tsx',
        markers: ['const tutorialGroups:', 'navigation.navigate(group.target)']
      }
    ],
    contract: sharedContract(
      'apps/web/src/lib/api.ts',
      'apps/mobile/src/lib/api.ts',
      ['public getBalance', '/api/billing/balance']
    ),
    verification: [
      {
        path: 'apps/mobile/tests/jobs.test.ts',
        markers: ["describe('mobile job API'", "toContain('/api/jobs?')"]
      },
      {
        path: 'apps/mobile/tests/JobCreditSettlement.test.tsx',
        markers: ['charged_credits', 'refunded_credits', 'net_credits']
      },
      {
        path: 'apps/mobile/src/screens/GuideScreen.tsx',
        markers: ['stepKeys', 'PrimaryButton']
      }
    ]
  }
];

function sharedContract(webPath, mobilePath, markers) {
  return {
    kind: 'shared-api',
    web: [{ path: webPath, markers }],
    mobile: [{ path: mobilePath, markers }]
  };
}

function relativePath(root, path) {
  const absolutePath = resolve(root, path);
  if (relative(root, absolutePath).startsWith('..')) {
    throw new Error(`Audit evidence path must stay inside the project root: ${path}`);
  }
  return absolutePath;
}

function parseAuditCRequirements(specContents) {
  const auditC = specContents.match(/### Audit C(?::[^\n]*)?\n([\s\S]*?)\n### Audit D(?::[^\n]*)?\n/);
  if (auditC === null) {
    throw new Error('Could not locate Audit C requirements in the Mobile completion gap spec.');
  }

  return auditC[1]
    .split('\n')
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1] ?? null)
    .filter((requirement) => requirement !== null);
}

function readEvidence(root, category, entries, errors) {
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push(`${category}: evidence must include at least one path and marker.`);
    return [];
  }

  return entries.map((entry) => {
    if (typeof entry?.path !== 'string' || !Array.isArray(entry.markers) || entry.markers.length === 0) {
      errors.push(`${category}: invalid evidence definition.`);
      return { path: String(entry?.path ?? '<invalid>'), markers: [] };
    }

    const evidencePath = relativePath(root, entry.path);
    if (!existsSync(evidencePath)) {
      errors.push(`${category}: missing path ${entry.path}`);
      return entry;
    }

    const contents = readFileSync(evidencePath, 'utf8');
    for (const marker of entry.markers) {
      if (typeof marker !== 'string' || marker.length === 0) {
        errors.push(`${category}: ${entry.path} has an invalid marker.`);
      } else if (!contents.includes(marker)) {
        errors.push(`${category}: ${entry.path} is missing marker ${JSON.stringify(marker)}.`);
      }
    }
    return entry;
  });
}

function auditRequirement(root, entry, errors) {
  const prefix = entry.requirement;
  const web = readEvidence(root, `${prefix} / Web`, entry.web, errors);
  const mobile = readEvidence(root, `${prefix} / Mobile`, entry.mobile, errors);
  const verification = readEvidence(root, `${prefix} / Verification`, entry.verification, errors);

  if (entry.contract?.kind === 'shared-api') {
    const webContract = readEvidence(root, `${prefix} / shared contract Web`, entry.contract.web, errors);
    const mobileContract = readEvidence(root, `${prefix} / shared contract Mobile`, entry.contract.mobile, errors);
    return { ...entry, web, mobile, verification, contract: { ...entry.contract, web: webContract, mobile: mobileContract } };
  }

  if (entry.contract?.kind === 'intentional-mobile-difference' && typeof entry.contract.reason === 'string' && entry.contract.reason.trim().length > 0) {
    return { ...entry, web, mobile, verification };
  }

  errors.push(`${prefix}: shared API/contract evidence or an intentional Mobile difference reason is required.`);
  return { ...entry, web, mobile, verification };
}

function formatEvidence(entries) {
  return entries
    .map((entry) => `\`${entry.path}\`<br><small>markers: ${entry.markers.map((marker) => `\`${escapeCell(marker)}\``).join(', ')}</small>`)
    .join('<br><br>');
}

function formatContract(contract) {
  if (contract.kind === 'intentional-mobile-difference') {
    return `Intentional Mobile difference: ${escapeCell(contract.reason)}`;
  }
  return [
    '<strong>Web</strong><br>' + formatEvidence(contract.web),
    '<strong>Mobile</strong><br>' + formatEvidence(contract.mobile)
  ].join('<br><br>');
}

function escapeCell(value) {
  return value.replaceAll('|', '\\|');
}

function renderInventory(requirements) {
  return [
    '# Mobile Web Parity Inventory',
    '',
    'Generated by `scripts/auditMobileWebParity.mjs` from the Audit C requirements in',
    '`docs/mobile_completion_gap_spec.md`. Edit the generator, not this file.',
    '',
    `Requirements: ${requirements.length}`,
    '',
    'Unclassified requirements: 0',
    '',
    '| Web requirement | Mobile behavior | Web implementation evidence | Mobile implementation evidence | Shared contract / intentional Mobile difference | Verification evidence |',
    '|---|---|---|---|---|---|',
    ...requirements.map((entry) =>
      `| ${escapeCell(entry.requirement)} | ${escapeCell(entry.behavior)} | ${formatEvidence(entry.web)} | ${formatEvidence(entry.mobile)} | ${formatContract(entry.contract)} | ${formatEvidence(entry.verification)} |`
    ),
    ''
  ].join('\n');
}

export function auditMobileWebParity({
  projectRoot: root = projectRoot,
  specPath = 'docs/mobile_completion_gap_spec.md',
  requirements = auditCRequirements
} = {}) {
  const errors = [];
  const specFile = relativePath(root, specPath);
  if (!existsSync(specFile)) {
    throw new Error(`Mobile completion gap spec is missing: ${specPath}`);
  }

  const specRequirements = parseAuditCRequirements(readFileSync(specFile, 'utf8'));
  const definitionNames = requirements.map((entry) => entry.requirement);
  const duplicateDefinitions = definitionNames.filter((name, index) => definitionNames.indexOf(name) !== index);
  if (duplicateDefinitions.length > 0) {
    errors.push(`Duplicate Audit C definitions: ${[...new Set(duplicateDefinitions)].join(', ')}`);
  }

  const unclassified = specRequirements.filter((requirement) => !definitionNames.includes(requirement));
  if (unclassified.length > 0) {
    errors.push(`Unclassified Audit C requirements: ${unclassified.join(', ')}`);
  }

  const staleDefinitions = definitionNames.filter((requirement) => !specRequirements.includes(requirement));
  if (staleDefinitions.length > 0) {
    errors.push(`Audit C definitions not present in the spec: ${staleDefinitions.join(', ')}`);
  }

  const auditedRequirements = requirements.map((entry) => auditRequirement(root, entry, errors));
  if (errors.length > 0) {
    throw new Error(`Mobile Web parity audit failed:\n${errors.join('\n')}`);
  }

  return {
    inventory: renderInventory(auditedRequirements),
    requirements: auditedRequirements,
    specRequirements
  };
}

function runCli() {
  const write = process.argv.includes('--write');
  const check = process.argv.includes('--check');
  if (write === check) {
    throw new Error('Pass exactly one of --write or --check.');
  }

  const outputPath = resolve(projectRoot, 'docs/mobile-web-parity-inventory.md');
  const { inventory } = auditMobileWebParity();
  if (write) {
    writeFileSync(outputPath, inventory, 'utf8');
    process.stdout.write(`Wrote ${outputPath}\n`);
    return;
  }

  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
  if (current !== inventory) {
    process.stderr.write('Mobile Web parity inventory is stale. Run `npm run mobile:web-parity:generate`.\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
