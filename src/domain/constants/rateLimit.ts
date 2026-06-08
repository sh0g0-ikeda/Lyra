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
export const ENTITY_GENERATION_ROUTE_PATTERN = /^\/api\/entities\/[^/]+\/generate-reference$/;
export const STORY_ROUTE_PREFIXES = ['/api/story', '/api/works', '/api/chapters', '/api/episodes'] as const;
