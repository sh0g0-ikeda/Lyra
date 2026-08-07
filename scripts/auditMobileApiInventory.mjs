import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const mobileApiPath = path.join(repositoryRoot, 'apps/mobile/src/lib/api.ts');
const routesDirectory = path.join(repositoryRoot, 'src/routes');
const inventoryPath = path.join(repositoryRoot, 'docs/mobile-api-method-inventory.md');
const backendInventoryPath = path.join(
  repositoryRoot,
  'docs/mobile-backend-route-inventory.md',
);
const mobileSourceDirectory = path.join(repositoryRoot, 'apps/mobile/src');
const mode = process.argv[2] ?? '--check';

const routeMountPrefixes = new Map([
  ['account.ts', '/api'],
  ['adminOrganizations.ts', '/api'],
  ['balloons.ts', '/api'],
  ['billing.ts', '/api/billing'],
  ['compositions.ts', '/api'],
  ['entities.ts', '/api'],
  ['entityReferenceUploads.ts', '/api'],
  ['exports.ts', '/api'],
  ['health.ts', ''],
  ['jobs.ts', '/api'],
  ['localAssets.ts', ''],
  ['me.ts', '/api'],
  ['mobilePurchases.ts', '/api/mobile-purchases'],
  ['mobilePurchaseWebhooks.ts', '/api/webhooks/mobile-purchases'],
  ['organizations.ts', '/api'],
  ['pages.ts', '/api'],
  ['panelEntityAssignments.ts', '/api'],
  ['panelFrames.ts', '/api'],
  ['panels.ts', '/api'],
  ['pushTokens.ts', '/api'],
  ['scenes.ts', '/api'],
  ['story.ts', '/api'],
]);

const explicitBackendRouteClassifications = new Map([
  ['GET /healthz', ['Health-only', 'ALB/ECS health probe; explicitly excluded from the Mobile client.']],
  ['GET /readyz', ['Health-only', 'ALB/ECS readiness probe; explicitly excluded from the Mobile client.']],
  ['GET /local-assets/*', ['Local-only', 'Development asset server; production Mobile must never use it.']],
  ['PATCH /admin/organizations/:*\/contract', ['Operator-only', 'Administrative contract operation, not a consumer Mobile capability.']],
  ['POST /admin/organizations/:*\/credits/grants', ['Operator-only', 'Administrative credit grant, not a consumer Mobile capability.']],
  ['POST /webhooks/stripe', ['Provider-only', 'Stripe-to-server signed webhook.']],
  ['POST /', ['Provider compatibility', 'Legacy root Stripe webhook selected only by the Stripe-Signature header.']],
  ['POST /webhooks/mobile-purchases/apple', ['Provider-only', 'App Store server notification endpoint.']],
  ['POST /webhooks/mobile-purchases/google', ['Provider-only', 'Google Play RTDN push endpoint.']],
  ['POST /billing/checkout/subscription', ['Web-only store policy', 'Personal Web Stripe checkout must not be reused for Mobile digital purchases.']],
  ['POST /billing/checkout/credits', ['Web-only store policy', 'Personal Web Stripe credit checkout must not be reused for Mobile digital purchases.']],
  ['POST /billing/customer-portal', ['Web-only store policy', 'Personal Stripe portal remains a Web account operation.']],
  ['GET /organizations', ['Mobile bootstrap replacement', 'Mobile receives organization workspaces from the authoritative /api/me bootstrap response.']],
  ['GET /organizations/:*\/credits/balance', ['Mobile aggregate replacement', 'Mobile receives the authoritative organization credit balance from the /api/me bootstrap response.']],
  ['GET /organizations/:*\/billing', ['Mobile-hidden', 'Organization Stripe billing details are available only on the Web.']],
  ['GET /organizations/:*\/billing/plans', ['Mobile-hidden', 'Organization Stripe billing plans are available only on the Web.']],
  ['GET /organizations/:*\/invoices', ['Mobile-hidden', 'Organization Stripe invoices are available only on the Web.']],
  ['POST /organizations/:*\/billing/checkout/subscription', ['Mobile-hidden', 'Organization Stripe subscription checkout is available only on the Web.']],
  ['POST /organizations/:*\/billing/checkout/credits', ['Mobile-hidden', 'Organization Stripe credit checkout is available only on the Web.']],
  ['POST /organizations/:*\/billing/customer-portal', ['Mobile-hidden', 'Organization Stripe customer portal is available only on the Web.']],
  ['POST /invitations/:*\/accept', ['Compatibility', 'Legacy invitation acceptance alias; Mobile uses /api/organization-invitations/accept.']],
  ['POST /organizations/:*\/billing/subscription-checkout-session', ['Mobile-hidden', 'Legacy organization Stripe checkout is available only on the Web.']],
  ['POST /organizations/:*\/billing/credit-pack-checkout-session', ['Mobile-hidden', 'Legacy organization Stripe credit checkout is available only on the Web.']],
  ['POST /organizations/:*\/billing/customer-portal-session', ['Mobile-hidden', 'Legacy organization Stripe customer portal is available only on the Web.']],
  ['POST /pages/:*\/generate', ['Mobile safety replacement', 'Mobile uses atomic /save-and-generate so unsaved inputs cannot diverge from the queued snapshot.']],
  ['POST /pages/:*\/balloons', ['Mobile-hidden', 'External dialogue editing remains intentionally unavailable until the complete balloon finalize flow is released.']],
  ['GET /pages/:*\/balloons', ['Mobile-hidden', 'External dialogue editing remains intentionally unavailable until the complete balloon finalize flow is released.']],
  ['POST /pages/:*\/auto-balloons', ['Mobile-hidden', 'External dialogue editing remains intentionally unavailable until the complete balloon finalize flow is released.']],
  ['PUT /balloons/:*', ['Mobile-hidden', 'External dialogue editing remains intentionally unavailable until the complete balloon finalize flow is released.']],
  ['DELETE /balloons/:*', ['Mobile-hidden', 'External dialogue editing remains intentionally unavailable until the complete balloon finalize flow is released.']],
]);

const mobileRouteCallerOverrides = new Map([
  ['GET /pages/:*\/export-image', 'PagesScreen authenticated file download and native share flow.'],
  ['GET /pages/:*\/thumbnail', 'PageThumbnailPicker authenticated bounded-thumbnail source.'],
  ['GET /exports/:*\/download', 'ExportJobCard authenticated signed-download handoff.'],
  ['GET /organizations/:*\/usage.csv', 'AccountScreen authenticated CSV download and native share flow.'],
  ['GET /entities/:*\/reference/:*\/image', 'Authenticated entity-reference image source.'],
  ['GET /entities/:*\/reference-candidate-image', 'Authenticated entity candidate preview source.'],
]);

const sourceText = fs.readFileSync(mobileApiPath, 'utf8');
const sourceFile = ts.createSourceFile(
  mobileApiPath,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

const apiClass = sourceFile.statements.find(
  (statement) =>
    ts.isClassDeclaration(statement)
    && statement.name?.text === 'LyraMobileApiClient',
);
if (apiClass === undefined || !ts.isClassDeclaration(apiClass)) {
  throw new Error('LyraMobileApiClient was not found');
}

const backendRoutes = collectBackendRoutes(routesDirectory);
const inventory = apiClass.members
  .filter(ts.isMethodDeclaration)
  .filter((method) => hasModifier(method, ts.SyntaxKind.PublicKeyword))
  .map((method) => buildInventoryEntry(method, sourceFile, backendRoutes))
  .map((entry) => ({
    ...entry,
    mobileCallers: collectMobileMethodCallers(
      mobileSourceDirectory,
      entry.method,
      mobileApiPath,
    ),
  }));

if (inventory.length < 100) {
  throw new Error(`Mobile API inventory unexpectedly contains only ${inventory.length} methods`);
}

const missingRoutes = inventory.filter((entry) => !entry.backendRouteExists);
if (missingRoutes.length > 0) {
  throw new Error(
    `Backend routes are missing for: ${missingRoutes.map((entry) => entry.method).join(', ')}`,
  );
}

const missingContracts = inventory.filter((entry) => entry.responseContract === 'unknown');
if (missingContracts.length > 0) {
  throw new Error(
    `Response contracts are missing for: ${missingContracts.map((entry) => entry.method).join(', ')}`,
  );
}

const markdown = renderMarkdown(inventory);
const backendInventory = buildBackendInventory(backendRoutes, inventory);
const unclassifiedBackendRoutes = backendInventory.filter(
  (entry) => entry.classification === 'UNCLASSIFIED',
);
if (unclassifiedBackendRoutes.length > 0) {
  throw new Error(
    `Backend routes need a Mobile path or explicit classification: ${
      unclassifiedBackendRoutes
        .map((entry) => `${entry.httpMethod} ${entry.route}`)
        .join(', ')
    }`,
  );
}
const backendMarkdown = renderBackendMarkdown(backendInventory);
if (mode === '--write') {
  fs.writeFileSync(inventoryPath, markdown, 'utf8');
  fs.writeFileSync(backendInventoryPath, backendMarkdown, 'utf8');
  process.stdout.write(`Wrote ${path.relative(repositoryRoot, inventoryPath)} (${inventory.length} methods)\n`);
  process.stdout.write(
    `Wrote ${path.relative(repositoryRoot, backendInventoryPath)} (${backendInventory.length} routes)\n`,
  );
} else if (mode === '--check') {
  if (!fs.existsSync(inventoryPath) || fs.readFileSync(inventoryPath, 'utf8') !== markdown) {
    throw new Error('Mobile API inventory is stale. Run: node scripts/auditMobileApiInventory.mjs --write');
  }
  if (
    !fs.existsSync(backendInventoryPath)
    || fs.readFileSync(backendInventoryPath, 'utf8') !== backendMarkdown
  ) {
    throw new Error(
      'Backend route inventory is stale. Run: node scripts/auditMobileApiInventory.mjs --write',
    );
  }
  process.stdout.write(`Mobile API inventory is current (${inventory.length} methods)\n`);
  process.stdout.write(
    `Backend route inventory is current (${backendInventory.length} routes)\n`,
  );
} else {
  throw new Error(`Unsupported mode: ${mode}`);
}

function buildInventoryEntry(method, apiSourceFile, routes) {
  const methodName = method.name.getText(apiSourceFile);
  const methodText = method.getText(apiSourceFile);
  const transportCall = findTransportCall(method);
  const transport = transportCall === null
    ? null
    : transportCall.expression.name.text;

  const special = specialMethodContract(methodName);
  const route = special?.route
    ?? (transportCall === null ? null : renderRoute(transportCall.arguments[0], apiSourceFile));
  const httpMethod = special?.httpMethod
    ?? inferHttpMethod(transport, transportCall, apiSourceFile);
  const responseContract = special?.responseContract
    ?? inferResponseContract(transport, transportCall, apiSourceFile);

  if (route === null) {
    throw new Error(`Could not determine a route for ${methodName}`);
  }

  const normalizedRoute = normalizeRoute(route);
  const backendRouteExists = routes.some(
    (candidate) =>
      candidate.httpMethod === httpMethod
      && candidate.normalizedRoute === normalizedRoute,
  );

  return {
    method: methodName,
    httpMethod,
    route,
    normalizedRoute,
    auth: methodName === 'previewOrganizationInvitation' ? 'public token' : 'required',
    organizationScope: inferOrganizationScope(methodText, route, methodName),
    responseContract,
    backendRouteExists,
  };
}

function findTransportCall(method) {
  const transportNames = new Set([
    'request',
    'requestVoid',
    'stream',
    'streamStoryCollaboration',
    'fetchWithAuthRetry',
  ]);
  let found = null;
  const visit = (node) => {
    if (
      found === null
      && ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
      && transportNames.has(node.expression.name.text)
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (method.body !== undefined) {
    visit(method.body);
  }
  return found;
}

function renderRoute(expression, apiSourceFile) {
  if (expression === undefined) {
    return null;
  }
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }
  if (!ts.isTemplateExpression(expression)) {
    return null;
  }

  let route = expression.head.text;
  for (const span of expression.templateSpans) {
    const expressionText = span.expression.getText(apiSourceFile);
    if (expressionText.includes('organizationQuery(')) {
      route += '?organization_id';
    } else if (expressionText.includes('listPageQuery(')) {
      route += '?pagination';
    } else if (expressionText.includes('jobListQuery(')) {
      route += '?filters';
    } else if (expressionText.includes('params.toString()')) {
      route += route.includes('?') ? 'query' : '?query';
    } else {
      route += `:${parameterName(expressionText)}`;
    }
    route += span.literal.text;
  }
  return route;
}

function parameterName(expressionText) {
  const identifiers = expressionText.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  const ignored = new Set(['encodeURIComponent']);
  return identifiers.reverse().find((identifier) => !ignored.has(identifier)) ?? 'param';
}

function inferHttpMethod(transport, call, apiSourceFile) {
  if (transport === 'stream' || transport === 'streamStoryCollaboration') {
    return 'POST';
  }
  const initArgumentIndex = transport === 'request' ? 2 : 1;
  const init = call?.arguments[initArgumentIndex];
  if (init !== undefined && ts.isObjectLiteralExpression(init)) {
    const methodProperty = init.properties.find(
      (property) =>
        ts.isPropertyAssignment(property)
        && property.name.getText(apiSourceFile) === 'method',
    );
    if (
      methodProperty !== undefined
      && ts.isPropertyAssignment(methodProperty)
      && ts.isStringLiteralLike(methodProperty.initializer)
    ) {
      return methodProperty.initializer.text.toUpperCase();
    }
  }
  return 'GET';
}

function inferResponseContract(transport, call, apiSourceFile) {
  if (transport === 'request') {
    return call?.arguments[1]?.getText(apiSourceFile) ?? 'unknown';
  }
  if (transport === 'requestVoid') {
    return 'void (204)';
  }
  if (transport === 'stream' || transport === 'streamStoryCollaboration') {
    return 'storyCollaborationEventSchema (SSE)';
  }
  if (transport === 'fetchWithAuthRetry') {
    return 'binary response';
  }
  return 'unknown';
}

function specialMethodContract(methodName) {
  if (methodName === 'collaborateStory') {
    return {
      route: '/api/story/collaborate?organization_id',
      httpMethod: 'POST',
      responseContract: 'storyCollaborationEventSchema (SSE)',
    };
  }
  if (methodName === 'requestAccountDeletion') {
    return {
      route: '/api/account/deletion',
      httpMethod: 'POST',
      responseContract: 'accountDeletionResultSchema',
    };
  }
  return null;
}

function inferOrganizationScope(methodText, route, methodName) {
  if (methodName === 'previewOrganizationInvitation') {
    return 'public invitation token';
  }
  if (route.includes('/organizations/:')) {
    return 'organization path';
  }
  if (
    methodText.includes('organizationId')
    || route.includes('organization_id')
    || methodText.includes('jobListQuery(')
  ) {
    return 'personal or organization';
  }
  if (methodName === 'acceptOrganizationInvitation' || methodName === 'createOrganization') {
    return 'authenticated account';
  }
  return 'personal or global';
}

function collectBackendRoutes(directory) {
  const routesByKey = new Map();

  for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.ts'))) {
    const filePath = path.join(directory, name);
    const text = fs.readFileSync(filePath, 'utf8');
    const file = ts.createSourceFile(
      filePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'app'
        && ['get', 'post', 'put', 'patch', 'delete'].includes(node.expression.name.text)
        && node.arguments.length > 0
        && ts.isStringLiteralLike(node.arguments[0])
      ) {
        const httpMethod = node.expression.name.text.toUpperCase();
        const route = mountedBackendRoute(name, node.arguments[0].text);
        const normalizedRoute = normalizeRoute(route);
        const key = `${httpMethod} ${normalizedRoute}`;
        const existing = routesByKey.get(key);
        if (existing === undefined) {
          routesByKey.set(key, {
            httpMethod,
            route,
            normalizedRoute,
            sources: [path.relative(repositoryRoot, filePath).replaceAll('\\', '/')],
          });
        } else if (!existing.sources.includes(path.relative(repositoryRoot, filePath))) {
          existing.sources.push(path.relative(repositoryRoot, filePath).replaceAll('\\', '/'));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  return [...routesByKey.values()].sort((left, right) =>
    left.route.localeCompare(right.route) || left.httpMethod.localeCompare(right.httpMethod)
  );
}

function mountedBackendRoute(fileName, localRoute) {
  if (fileName === 'webhooks.ts') {
    return localRoute === '/' ? '/' : joinRoute('/api/webhooks', localRoute);
  }
  const mountPrefix = routeMountPrefixes.get(fileName);
  if (mountPrefix === undefined) {
    throw new Error(`A route mount prefix is not classified for ${fileName}`);
  }
  return joinRoute(mountPrefix, localRoute);
}

function joinRoute(prefix, route) {
  const joined = `${prefix}/${route}`.replace(/\/+/gu, '/');
  return joined.length > 1 ? joined.replace(/\/+$/u, '') : '/';
}

function collectMobileMethodCallers(directory, methodName, excludedPath) {
  const escapedMethodName = methodName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const callPattern = new RegExp(`\\.${escapedMethodName}\\s*\\(`, 'u');
  const callers = [];

  for (const filePath of collectSourceFiles(directory)) {
    if (path.resolve(filePath) === path.resolve(excludedPath)) {
      continue;
    }
    if (callPattern.test(fs.readFileSync(filePath, 'utf8'))) {
      callers.push(path.relative(repositoryRoot, filePath).replaceAll('\\', '/'));
    }
  }

  return callers.sort();
}

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(entryPath);
    }
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [entryPath] : [];
  });
}

function buildBackendInventory(routes, mobileEntries) {
  return routes.map((route) => {
    const matchingMethods = mobileEntries.filter(
      (entry) =>
        entry.httpMethod === route.httpMethod
        && entry.normalizedRoute === route.normalizedRoute,
    );
    const mobileCallers = [...new Set(
      matchingMethods.flatMap((entry) => entry.mobileCallers),
    )].sort();
    const key = `${route.httpMethod} ${route.normalizedRoute}`;
    const callerOverride = mobileRouteCallerOverrides.get(key);
    const explicitClassification = explicitBackendRouteClassifications.get(key);

    if (mobileCallers.length > 0) {
      return {
        ...route,
        classification: 'Mobile UI',
        rationale: `${
          matchingMethods.map((entry) => `api.${entry.method}`).join(', ')
        } -> ${mobileCallers.join(', ')}`,
      };
    }
    if (callerOverride !== undefined) {
      return {
        ...route,
        classification: 'Mobile UI',
        rationale: callerOverride,
      };
    }
    if (explicitClassification !== undefined) {
      return {
        ...route,
        classification: explicitClassification[0],
        rationale: explicitClassification[1],
      };
    }

    return {
      ...route,
      classification: 'UNCLASSIFIED',
      rationale:
        matchingMethods.length === 0
          ? 'No matching Mobile API method.'
          : `No Mobile source caller for ${matchingMethods.map((entry) => `api.${entry.method}`).join(', ')}.`,
    };
  });
}

function normalizeRoute(route) {
  return route
    .replace(/^\/api/, '')
    .split('?')[0]
    .replace(/:[A-Za-z0-9_]+/g, ':*')
    .replace(/\/+$/, '') || '/';
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function renderMarkdown(entries) {
  const rows = entries.map((entry) =>
    `| \`${entry.method}\` | ${entry.httpMethod} | \`${entry.route}\` | ${entry.auth} | ${entry.organizationScope} | \`${entry.responseContract}\` |`,
  );
  return [
    '# Mobile API Method Inventory',
    '',
    'Generated by `node scripts/auditMobileApiInventory.mjs --write`.',
    'Do not edit this table manually. `--check` compares every public Mobile API method with a Backend Hono route.',
    '',
    `Total public methods: **${entries.length}**`,
    '',
    '| Mobile method | HTTP | Route | Auth | Organization scope | Response contract |',
    '|---|---:|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function renderBackendMarkdown(entries) {
  const unclassifiedCount = entries.filter(
    (entry) => entry.classification === 'UNCLASSIFIED',
  ).length;
  const rows = entries.map(
    (entry) =>
      `| \`${entry.route}\` | ${entry.httpMethod} | ${entry.classification} | ${entry.rationale} |`,
  );
  return [
    '# Mobile Backend Route Inventory',
    '',
    'Generated by `node scripts/auditMobileApiInventory.mjs --write`.',
    'Do not edit this table manually. `--check` fails when a Backend route lacks a concrete Mobile path or an exact reviewed exclusion.',
    '',
    `Total mounted routes: **${entries.length}**`,
    '',
    `Unclassified routes: **${unclassifiedCount}**`,
    '',
    '| Backend route | HTTP | Classification | Mobile path / rationale |',
    '|---|---:|---|---|',
    ...rows,
    '',
  ].join('\n');
}
