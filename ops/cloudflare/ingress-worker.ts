/**
 * Unified Spec §§3/4/7/8/9: this adapter changes ingress only. The existing API
 * owns authentication, authorization, billing and readiness. Trust viewer IP only
 * from Cloudflare's platform header at the public route; overwrite visitor guard
 * and viewer headers. Exact public documents use a credential-free allowlist.
 * Preserve raw request/response streams and status; never retry a mutation or
 * flush an early success response. Missing configuration fails closed.
 */
export interface IngressEnvironment {
  /** Encrypted Worker secret binding; never a plaintext Wrangler variable. */
  LYRA_ORIGIN_GUARD?: string;
}

export interface OriginFetchInit extends RequestInit {
  cf: { cacheEverything: boolean; cacheTtlByStatus: Record<string, number> };
}

export type OriginFetch = (request: Request, init: OriginFetchInit) => Promise<Response>;

const APPLICATION_ORIGINS = new Set([
  'https://app.lyra-editor.com',
  'https://lyra-tunnel-canary.lyra-editor.com',
]);
const PUBLIC_DOCUMENT_ORIGIN = 'https://d1a1300ysx6i1r.cloudfront.net';
const ORIGIN_GUARD_HEADER = 'X-Lyra-Origin-Guard';
const VIEWER_ADDRESS_HEADER = 'CloudFront-Viewer-Address';
const PUBLIC_DOCUMENT_PATHS = new Set([
  '/.well-known/assetlinks.json',
  '/privacy.html',
  '/terms.html',
  '/support.html',
  '/legal.css',
]);
const PUBLIC_REQUEST_HEADERS = [
  'accept', 'accept-encoding', 'accept-language', 'range',
  'if-range', 'if-none-match', 'if-modified-since',
] as const;
const UNTRUSTED_FORWARDING_HEADERS = [
  'x-forwarded-for', 'x-real-ip', 'true-client-ip', 'forwarded',
] as const;
const CACHE_HEADERS = [
  'Cache-Control', 'CDN-Cache-Control', 'Cloudflare-CDN-Cache-Control',
] as const;

export async function handleRequest(
  request: Request,
  environment: IngressEnvironment,
  fetchOrigin: OriginFetch = fetch,
): Promise<Response> {
  const secret = environment.LYRA_ORIGIN_GUARD;
  if (typeof secret !== 'string' || secret.trim().length === 0 || !/^[\x20-\x7e]+$/u.test(secret)) {
    return failureResponse(503, 'Service unavailable');
  }
  const url = new URL(request.url);
  if (!APPLICATION_ORIGINS.has(url.origin)) {
    return failureResponse(404, 'Not found');
  }

  const isPublicDocument = PUBLIC_DOCUMENT_PATHS.has(url.pathname);
  if (isPublicDocument && request.method !== 'GET' && request.method !== 'HEAD') {
    return failureResponse(403, 'Forbidden');
  }

  let forwardedRequest: Request;
  if (isPublicDocument) {
    const headers = new Headers();
    for (const name of PUBLIC_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    // A different hostname bypasses this Worker route and reaches existing S3 OAC.
    const destination = new URL(url.pathname + url.search, PUBLIC_DOCUMENT_ORIGIN);
    forwardedRequest = new Request(destination, {
      method: request.method, headers, redirect: 'manual', cache: 'no-store',
      signal: request.signal,
    });
  } else {
    const headers = new Headers(request.headers);
    headers.set(ORIGIN_GUARD_HEADER, secret.trim());
    headers.delete(VIEWER_ADDRESS_HEADER);
    // Older API versions may fall back to this header; never forward an
    // unvalidated alternative after rejecting the trusted viewer address.
    headers.delete('CF-Connecting-IP');
    for (const name of UNTRUSTED_FORWARDING_HEADERS) headers.delete(name);
    // Cloudflare supplies this header at the public route. Never deploy this
    // trust boundary as a generic proxy accepting arbitrary caller metadata.
    const clientIp = request.headers.get('CF-Connecting-IP');
    if (clientIp !== null && isIpAddress(clientIp)) {
      headers.set(VIEWER_ADDRESS_HEADER, clientIp);
    }
    // Same-host route subrequests reach the configured Tunnel origin. Preserve
    // body streaming, method, URL and authentication; deployment must canary the
    // route/origin configuration before production DNS cutover.
    forwardedRequest = new Request(request, {
      headers, redirect: 'manual', cache: 'no-store',
    });
  }

  try {
    const response = await fetchOrigin(forwardedRequest, {
      cf: { cacheEverything: false, cacheTtlByStatus: { '100-599': -1 } },
    });
    const headers = new Headers(response.headers);
    for (const name of CACHE_HEADERS) headers.set(name, 'no-store');
    return new Response(response.body, {
      status: response.status, statusText: response.statusText, headers,
    });
  } catch {
    // A network exception cannot justify retrying a potentially committed POST.
    // Keep provider errors, credentials and internal URLs out of responses/logs.
    return failureResponse(502, 'Bad gateway');
  }
}

function failureResponse(status: number, message: string): Response {
  const headers = new Headers({ 'Content-Type': 'text/plain; charset=utf-8' });
  for (const name of CACHE_HEADERS) headers.set(name, 'no-store');
  return new Response(message, { status, headers });
}

function isIpv4Address(value: string): boolean {
  const octets = value.split('.');
  return octets.length === 4 && octets.every((octet) => (
    /^(?:0|[1-9][0-9]{0,2})$/u.test(octet) && Number(octet) <= 255
  ));
}

function isIpAddress(value: string): boolean {
  if (isIpv4Address(value)) return true;
  // IPv6 may end in an embedded IPv4 address. Ports, brackets, zone identifiers,
  // whitespace and lists are not a single platform-supplied client address.
  if (value.length > 45 || !/^[0-9a-f:.]+$/iu.test(value) || !value.includes(':')) return false;
  let expandedTail = value;
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    if (!isIpv4Address(value.slice(lastColon + 1))) return false;
    expandedTail = value.slice(0, lastColon + 1) + '0:0';
  }
  const halves = expandedTail.split('::');
  if (halves.length > 2) return false;
  const groups = halves.flatMap((half) => half.length === 0 ? [] : half.split(':'));
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/iu.test(group))) return false;
  return halves.length === 2 ? groups.length < 8 : groups.length === 8;
}

export default {
  // Cloudflare passes ExecutionContext as the third argument. Keep the test
  // fetch port separate so that context is never mistaken for a fetch function.
  async fetch(request: Request, environment: IngressEnvironment): Promise<Response> {
    return handleRequest(request, environment);
  },
};
