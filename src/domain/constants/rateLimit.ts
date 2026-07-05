export const RATE_LIMIT_RULES = {
  generation: {
    maxRequests: 10,
    windowSeconds: 60,
  },
  storyAi: {
    maxRequests: 20,
    windowSeconds: 60,
  },
  story: {
    maxRequests: 60,
    windowSeconds: 60,
  },
  invitation: {
    maxRequests: 30,
    windowSeconds: 60,
  },
  billingAction: {
    maxRequests: 12,
    windowSeconds: 60,
  },
  read: {
    maxRequests: 600,
    windowSeconds: 60,
  },
  default: {
    maxRequests: 100,
    windowSeconds: 60,
  },
  webhook: {
    maxRequests: 120,
    windowSeconds: 60,
  },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMIT_RULES;

export const PAGE_GENERATION_ROUTE_PATTERN = /^\/api\/pages\/[^/]+\/generate$/;
export const PAGE_AUTOFILL_ROUTE_PATTERN = /^\/api\/pages\/[^/]+\/autofill-from-scenes$/;
export const EPISODE_STORY_AUTOFILL_ROUTE_PATTERN = /^\/api\/episodes\/[^/]+\/autofill-pages-from-story$/;
export const PAGE_SKELETON_GENERATION_ROUTE_PATTERN = /^\/api\/episodes\/[^/]+\/generate-page-skeleton$/;
export const ENTITY_IMPORT_ROUTE_PATTERN = /^\/api\/entities\/import-image$/;
export const ENTITY_GENERATION_ROUTE_PATTERN = /^\/api\/entities\/[^/]+\/generate-reference$/;
export const STORY_COLLABORATION_ROUTE_PATTERN = /^\/api\/story\/collaborate$/;
export const STORY_EPISODE_IMPROVEMENT_ROUTE_PATTERN = /^\/api\/story\/improve-episode-draft$/;
export const ORGANIZATION_INVITATION_ROUTE_PATTERNS = [
  /^\/api\/organizations\/[^/]+\/invitations$/,
  /^\/api\/organizations\/[^/]+\/invitations\/[^/]+\/resend$/,
  /^\/api\/organizations\/[^/]+\/invitations\/[^/]+\/revoke$/,
  /^\/api\/organization-invitations\/accept$/,
  /^\/api\/invitations\/[^/]+\/accept$/,
] as const;
export const BILLING_ACTION_ROUTE_PATTERNS = [
  /^\/api\/billing\/checkout\/subscription$/,
  /^\/api\/billing\/checkout\/credits$/,
  /^\/api\/billing\/customer-portal$/,
  /^\/api\/organizations\/[^/]+\/billing\/checkout\/subscription$/,
  /^\/api\/organizations\/[^/]+\/billing\/subscription-checkout-session$/,
  /^\/api\/organizations\/[^/]+\/billing\/checkout\/credits$/,
  /^\/api\/organizations\/[^/]+\/billing\/credit-pack-checkout-session$/,
  /^\/api\/organizations\/[^/]+\/billing\/customer-portal$/,
  /^\/api\/organizations\/[^/]+\/billing\/customer-portal-session$/,
] as const;
export const STORY_ROUTE_PREFIXES = ['/api/story', '/api/works', '/api/chapters', '/api/episodes', '/api/scenes'] as const;
