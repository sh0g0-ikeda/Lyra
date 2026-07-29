/* global http, E2E_NETWORK_CONTROL_URL, E2E_NETWORK_CONTROL_TOKEN, E2E_NETWORK_DEVICE_ID, E2E_NETWORK_STATE, E2E_RUN_ID */

const response = http.post(E2E_NETWORK_CONTROL_URL, {
  body: JSON.stringify({
    deviceId: E2E_NETWORK_DEVICE_ID,
    runId: E2E_RUN_ID,
    state: E2E_NETWORK_STATE
  }),
  headers: {
    Authorization: 'Bearer ' + E2E_NETWORK_CONTROL_TOKEN,
    'Content-Type': 'application/json'
  }
});

if (!response.ok) {
  throw new Error('Network control harness rejected the requested state.');
}
