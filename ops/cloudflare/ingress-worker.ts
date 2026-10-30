/**
 * Unified Spec §§3/4/7/8/9: this adapter changes ingress only. The existing API
 * owns authentication, authorization, billing and readiness. Trust viewer IP only
 * from Cloudflare's platform header, or from an AWS viewer address authenticated
 * by the incoming origin guard. Verify that guard with Web Crypto before replacing
 * it; accept only strict IP:port syntax and otherwise retain the platform fallback.
 * Exact public documents use a credential-free allowlist.
 * Preserve raw request/response streams and status; never retry a mutation or
 * flush an early success response. Missing configuration fails closed.
 * The optional app bridge has fixed off/canary modes only; it never accepts an
 * arbitrary origin and leaves public-document routing on CloudFront unchanged.
 */
export interface IngressEnvironment {
  /** Encrypted Worker secret binding; never a plaintext Wrangler variable. */
  LYRA_ORIGIN_GUARD?: string;
  /** Initial-off app API/SPA bridge to the fixed Tunnel canary origin. */
  LYRA_APP_ORIGIN_BRIDGE?: string;
}

export interface OriginFetchInit extends RequestInit {
  cf: { cacheEverything: boolean; cacheTtlByStatus: Record<string, number> };
}

export type OriginFetch = (request: Request, init: OriginFetchInit) => Promise<Response>;

const APPLICATION_ORIGIN = 'https://app.lyra-editor.com';
const CANARY_ORIGIN = 'https://lyra-tunnel-canary.lyra-editor.com';
const APPLICATION_ORIGINS = new Set([APPLICATION_ORIGIN, CANARY_ORIGIN]);
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
// Prevent cache storage and intermediary HTML/body transformations on every
// Worker response, including public documents proxied from CloudFront.
const RESPONSE_CACHE_CONTROL = 'no-store, no-transform';
type AppOriginBridge = 'off' | 'canary';

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
  const appOriginBridge = parseAppOriginBridge(environment.LYRA_APP_ORIGIN_BRIDGE);
  if (appOriginBridge === null) {
    return failureResponse(503, 'Service unavailable');
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
    // Authenticate the ORIGINAL guard before trusting the preceding AWS hop.
    // Invalid/missing AWS metadata keeps the existing Cloudflare IP fallback.
    const awsViewerIp = parseCloudFrontViewerAddress(request.headers.get(VIEWER_ADDRESS_HEADER));
    const fromTrustedCloudFront = awsViewerIp !== null
      && await matchesOriginGuard(request.headers.get(ORIGIN_GUARD_HEADER), secret.trim());
    const clientIp = fromTrustedCloudFront ? awsViewerIp : request.headers.get('CF-Connecting-IP');
    if (clientIp !== null && isIpAddress(clientIp)) {
      headers.set(VIEWER_ADDRESS_HEADER, clientIp);
    }
    // Same-host route subrequests reach the configured Tunnel origin. Preserve
    // body streaming, method, URL and authentication; deployment must canary the
    // route/origin configuration before production DNS cutover.
    if (appOriginBridge === 'canary' && url.origin === APPLICATION_ORIGIN) {
      // Assign path/search after constructing the fixed origin. A leading `//`
      // path must remain a path and never become an attacker-controlled authority.
      const destination = new URL(CANARY_ORIGIN);
      destination.pathname = url.pathname;
      destination.search = url.search;
      headers.set('Host', destination.host);
      const bridgedRequest = new Request(destination, request);
      forwardedRequest = new Request(bridgedRequest, {
        headers,
        redirect: 'manual', cache: 'no-store', signal: request.signal,
      });
    } else {
      forwardedRequest = new Request(request, {
        headers, redirect: 'manual', cache: 'no-store',
      });
    }
  }

  try {
    const response = await fetchOrigin(forwardedRequest, {
      cf: { cacheEverything: false, cacheTtlByStatus: { '100-599': -1 } },
    });
    const headers = new Headers(response.headers);
    for (const name of CACHE_HEADERS) headers.set(name, RESPONSE_CACHE_CONTROL);
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
  for (const name of CACHE_HEADERS) headers.set(name, RESPONSE_CACHE_CONTROL);
  return new Response(message, { status, headers });
}

function parseAppOriginBridge(value: string | undefined): AppOriginBridge | null {
  if (value === undefined || value === 'off') return 'off';
  return value === 'canary' ? 'canary' : null;
}

async function matchesOriginGuard(presented: string | null, expected: string): Promise<boolean> {
  if (presented === null) return false;
  // Use native HMAC verification rather than an early-exit string comparison.
  // No digest, key, supplied credential or verification detail leaves this scope.
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(expected), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(expected));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(presented));
}

function parseCloudFrontViewerAddress(value: string | null): string | null {
  if (value === null) return null;
  // AWS viewer endpoints are IPv4:port or [IPv6]:port. Do not guess the port
  // boundary in an unbracketed IPv6 address, trim internal spaces or accept lists.
  const match = /^(?:([0-9.]+)|\[([0-9a-f:.]+)\]):([1-9][0-9]{0,4})$/iu.exec(value);
  if (match === null || Number(match[3]) > 65535) return null;
  if (match[1] !== undefined) return isIpv4Address(match[1]) ? match[1] : null;
  const ipv6 = match[2];
  return ipv6 !== undefined && ipv6.includes(':') && isIpAddress(ipv6) ? ipv6 : null;
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
