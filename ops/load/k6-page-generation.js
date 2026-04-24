import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    enqueue_generation: {
      executor: 'constant-vus',
      vus: 16,
      duration: '30s',
    },
  },
};

const baseUrl = __ENV.LYRA_BASE_URL ?? 'http://localhost:3000';
const bearerToken = __ENV.LYRA_BEARER_TOKEN ?? '';
const pageId = __ENV.LYRA_PAGE_ID ?? '00000000-0000-4000-8000-000000000000';

export default function () {
  const response = http.post(`${baseUrl}/api/pages/${pageId}/generate`, null, {
    headers: bearerToken === '' ? {} : { Authorization: `Bearer ${bearerToken}` },
  });

  check(response, {
    'status is 202 or 409 or 422 or 429': (res) => [202, 409, 422, 429].includes(res.status),
    'request id exists': (res) => res.headers['X-Request-Id'] !== undefined,
  });

  sleep(1);
}
