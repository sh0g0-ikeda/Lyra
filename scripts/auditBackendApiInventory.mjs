import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const routesDirectory = path.join(repositoryRoot, 'src', 'routes');
const appPath = path.join(repositoryRoot, 'src', 'app.ts');
const inventoryPath = path.join(
  repositoryRoot,
  'docs',
  'backend-api-contract-inventory.md',
);
const mode = process.argv[2] ?? '--check';

const routeMethods = new Set([
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
]);

const routeMountPrefixes = new Map([
  ['adminOrganizations.ts', '/api'],
  ['balloons.ts', '/api'],
  ['billing.ts', '/api/billing'],
  ['compositions.ts', '/api'],
  ['entities.ts', '/api'],
  ['health.ts', ''],
  ['jobs.ts', '/api'],
  ['localAssets.ts', ''],
  ['me.ts', '/api'],
  ['organizations.ts', '/api'],
  ['pages.ts', '/api'],
  ['panelEntityAssignments.ts', '/api'],
  ['panelFrames.ts', '/api'],
  ['panels.ts', '/api'],
  ['scenes.ts', '/api'],
  ['story.ts', '/api'],
  ['webhooks.ts', '/api/webhooks'],
]);

const explicitResponseClassifications = new Map([
  [
    'GET /healthz',
    {
      response: 'Operational JSON',
      detail: 'Fixed liveness response',
    },
  ],
  [
    'GET /readyz',
    {
      response: 'Operational JSON',
      detail: 'Fixed readiness response',
    },
  ],
  [
    'OPTIONS /local-assets/*',
    {
      response: 'Empty',
      detail: 'Local CORS preflight (204)',
    },
  ],
  [
    'GET /local-assets/*',
    {
      response: 'Binary',
      detail: 'Development-only image bytes',
    },
  ],
  [
    'POST /api/webhooks/stripe',
    {
      response: 'Provider JSON ACK',
      detail: 'Stripe signature-verified acknowledgement',
    },
  ],
  [
    'POST /',
    {
      response: 'Provider JSON ACK',
      detail: 'Legacy Stripe webhook compatibility acknowledgement',
    },
  ],
  [
    'POST /api/story/collaborate',
    {
      response: 'Contracted SSE',
      detail: 'storyCollaborationEventSchema',
    },
  ],
  [
    'GET /api/organizations/:organizationId/usage.csv',
    {
      response: 'CSV',
      detail: 'Sanitized organization usage columns',
    },
  ],
  [
    'GET *',
    {
      response: 'Web static',
      detail: 'SPA/static-file fallback outside the API contract',
    },
  ],
]);

const paginationClassifications = new Map([
  [
    'GET /api/jobs',
    'Opaque cursor (1-100; max 512 chars)',
  ],
  [
    'GET /api/compositions',
    'Bounded limit (1-250)',
  ],
]);

const sourcePaths = [
  appPath,
  ...fs
    .readdirSync(routesDirectory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(routesDirectory, name)),
];

const definitions = sourcePaths.flatMap(collectRouteDefinitions);
const inventory = mergeRouteDefinitions(definitions);
const markdown = renderInventory(inventory);

if (mode === '--write') {
  fs.writeFileSync(inventoryPath, markdown, 'utf8');
  process.stdout.write(
    `Wrote ${path.relative(repositoryRoot, inventoryPath)} (${inventory.length} endpoints)\n`,
  );
} else if (mode === '--check') {
  if (
    !fs.existsSync(inventoryPath)
    || normalizeNewlines(fs.readFileSync(inventoryPath, 'utf8')) !== markdown
  ) {
    throw new Error(
      'Backend API inventory is stale. Run: npm run api:inventory:write',
    );
  }
  process.stdout.write(
    `Backend API inventory is current (${inventory.length} endpoints)\n`,
  );
} else {
  throw new Error(`Unsupported mode: ${mode}`);
}

function collectRouteDefinitions(filePath) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const localHandlers = collectLocalHandlers(sourceFile);
  const definitionsForFile = [];

  const visit = (node) => {
    if (isPotentialRouteRegistration(node)) {
      if (
        node.arguments.length < 2
        || !ts.isStringLiteralLike(node.arguments[0])
      ) {
        throw new Error(
          `Backend route path must be a string literal in ${toRepositoryPath(filePath)}`,
        );
      }
      const localPath = node.arguments[0].text;
      const method = node.expression.name.text.toUpperCase();
      const route = mountedRoute(filePath, localPath);
      const handlerArgument = node.arguments.at(-1);
      const handler = resolveHandler(handlerArgument, localHandlers);
      const key = `${method} ${route}`;
      const response = classifyResponse(key, handler, sourceFile);
      definitionsForFile.push({
        method,
        route,
        auth: classifyAuth(key),
        response: response.response,
        detail: response.detail,
        pagination: paginationClassifications.get(key) ?? 'Complete collection',
        source: toRepositoryPath(filePath),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return definitionsForFile;
}

function collectLocalHandlers(sourceFile) {
  const handlers = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer !== undefined
    ) {
      handlers.set(node.name.text, node.initializer);
    } else if (
      ts.isFunctionDeclaration(node)
      && node.name !== undefined
    ) {
      handlers.set(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return handlers;
}

function isPotentialRouteRegistration(node) {
  return (
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'app'
    && routeMethods.has(node.expression.name.text)
  );
}

function resolveHandler(handler, localHandlers) {
  if (handler === undefined) {
    return null;
  }
  if (ts.isIdentifier(handler)) {
    return localHandlers.get(handler.text) ?? handler;
  }
  return handler;
}

function mountedRoute(filePath, localPath) {
  if (path.resolve(filePath) === path.resolve(appPath)) {
    return normalizeJoinedRoute('', localPath);
  }

  const fileName = path.basename(filePath);
  if (fileName === 'webhooks.ts' && localPath === '/') {
    return '/';
  }
  const mountPrefix = routeMountPrefixes.get(fileName);
  if (mountPrefix === undefined) {
    throw new Error(`Route mount prefix is not classified for ${fileName}`);
  }
  return normalizeJoinedRoute(mountPrefix, localPath);
}

function normalizeJoinedRoute(prefix, localPath) {
  if (localPath === '*') {
    return prefix.length === 0 ? '*' : `${prefix}/*`;
  }
  const joined = `${prefix}/${localPath}`.replace(/\/+/gu, '/');
  return joined.length > 1 ? joined.replace(/\/+$/u, '') : '/';
}

function classifyResponse(key, handler, sourceFile) {
  const explicit = explicitResponseClassifications.get(key);
  if (explicit !== undefined) {
    return explicit;
  }
  if (handler === null) {
    return { response: 'UNCLASSIFIED', detail: 'Route handler was not resolved' };
  }

  const schemas = collectContractSchemas(handler, sourceFile);
  if (schemas.length > 0) {
    return {
      response: 'Strict JSON',
      detail: schemas.join(', '),
    };
  }

  const handlerText = handler.getText(sourceFile);
  if (/\.body\s*\(\s*null\s*,\s*204\b/u.test(handlerText)) {
    return { response: 'Empty', detail: 'No content (204)' };
  }
  if (
    /\.body\s*\(\s*new\s+Uint8Array\b/u.test(handlerText)
  ) {
    return { response: 'Binary', detail: 'Authenticated image bytes' };
  }

  return {
    response: 'UNCLASSIFIED',
    detail: 'Success response requires an explicit contract classification',
  };
}

function collectContractSchemas(handler, sourceFile) {
  const schemas = new Set();
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'assertMobileResponseContract'
      && node.arguments[0] !== undefined
    ) {
      schemas.add(node.arguments[0].getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(handler);
  return [...schemas].sort();
}

function classifyAuth(key) {
  if (key === 'GET /healthz' || key === 'GET /readyz') {
    return 'Public';
  }
  if (key.startsWith('OPTIONS /local-assets/') || key.startsWith('GET /local-assets/')) {
    return 'Local only';
  }
  if (key === 'POST /api/webhooks/stripe' || key === 'POST /') {
    return 'Provider signed';
  }
  if (key === 'GET /api/organization-invitations/:token') {
    return 'Public token';
  }
  if (key.startsWith('PATCH /api/admin/') || key.startsWith('POST /api/admin/')) {
    return 'Operator';
  }
  if (key === 'GET *') {
    return 'Public Web';
  }
  return 'Authenticated';
}

function mergeRouteDefinitions(routeDefinitions) {
  const grouped = new Map();
  for (const definition of routeDefinitions) {
    const key = `${definition.method} ${definition.route}`;
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, {
        ...definition,
        sources: [definition.source],
      });
      continue;
    }

    for (const field of ['auth', 'response', 'detail', 'pagination']) {
      if (existing[field] !== definition[field]) {
        throw new Error(
          `Inconsistent ${field} classification for ${key}: `
          + `${existing[field]} vs ${definition[field]}`,
        );
      }
    }
    if (!existing.sources.includes(definition.source)) {
      existing.sources.push(definition.source);
    }
  }

  const entries = [...grouped.values()];
  const unclassified = entries.filter((entry) => entry.response === 'UNCLASSIFIED');
  if (unclassified.length > 0) {
    throw new Error(
      `Backend routes require response classification: ${
        unclassified
          .map((entry) => `${entry.method} ${entry.route} (${entry.sources.join(', ')})`)
          .join('; ')
      }`,
    );
  }

  return entries
    .map((entry) => ({
      ...entry,
      sources: entry.sources.sort(),
    }))
    .sort(
      (left, right) =>
        left.route.localeCompare(right.route)
        || left.method.localeCompare(right.method),
    );
}

function renderInventory(entries) {
  const rows = entries.map((entry) => {
    const detail = entry.response === 'Strict JSON'
      ? entry.detail
        .split(', ')
        .map((schema) => `\`${schema}\``)
        .join(', ')
      : entry.detail;
    const sources = entry.sources
      .map((source) => `\`${source}\``)
      .join(', ');
    return `| \`${entry.route}\` | ${entry.method} | ${entry.auth} | ${entry.response} | ${detail} | ${entry.pagination} | ${sources} |`;
  });

  return [
    '# Backend API Contract Inventory',
    '',
    'Generated by `npm run api:inventory:write`; do not edit the table manually.',
    '`npm run api:inventory:check` fails when route, response contract, pagination, or source coverage drifts.',
    '',
    `Endpoint count: ${entries.length}`,
    '',
    '| Path | Method | Auth | Response | Contract / rationale | Pagination | Sources |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function toRepositoryPath(filePath) {
  return path.relative(repositoryRoot, filePath).replaceAll('\\', '/');
}

function normalizeNewlines(content) {
  return content.replace(/\r\n?/gu, '\n');
}
