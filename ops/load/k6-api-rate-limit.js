import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 16,
  duration: '1m',
};

const baseUrl = __ENV.LYRA_BASE_URL ?? 'http://localhost:3000';
const bearerToken = __ENV.LYRA_BEARER_TOKEN ?? '';

export default function () {
  const response = http.get(`${baseUrl}/api/billing/balance`, {
    headers: bearerToken === '' ? {} : { Authorization: `Bearer ${bearerToken}` },
  });

  check(response, {
    'status is 200 or 401 or 429': (res) => [200, 401, 429].includes(res.status),
    'request id exists': (res) => res.headers['X-Request-Id'] !== undefined,
  });

  sleep(1);
}
