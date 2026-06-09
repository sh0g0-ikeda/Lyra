export const RATE_LIMIT_RULES = {
  generation: {
    maxRequests: 10,
    windowSeconds: 60,
  },
  story: {
    maxRequests: 20,
    windowSeconds: 60,
  },
  default: {
    maxRequests: 100,
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
export const STORY_ROUTE_PREFIXES = ['/api/story', '/api/works', '/api/chapters', '/api/episodes'] as const;
