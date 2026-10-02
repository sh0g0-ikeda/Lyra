// Local serialization proof only. All credentials are deliberately synthetic;
// the request handler never opens a socket or contacts any endpoint.
import assert from 'node:assert/strict';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const requests = [];
let status = 200;
const client = new S3Client({
  region: 'ap-northeast-1', endpoint: 'https://offline.invalid', maxAttempts: 1,
  credentials: { accessKeyId: 'LOCAL_MODEL_ONLY', secretAccessKey: 'not-a-real-credential' },
  requestHandler: {
    handle: async (request) => {
      requests.push(request);
      return { response: {
        statusCode: status,
        headers: { etag: '"synthetic-etag"', 'x-amz-request-id': 'local-request', 'content-type': 'application/xml' },
        body: Buffer.from(status === 200 ? '' : '<Error><Code>ServiceUnavailable</Code><Message>local failure</Message></Error>'),
      } };
    },
    destroy: () => {},
  },
});
const base = {
  Bucket: 'synthetic-review-only', Key: 'state-attempts-v2/opaque-attempt',
  Metadata: { 'lyra-protocol': 'state-copy-v2', 'lyra-attempt': 'opaque-attempt' },
  ServerSideEncryption: 'AES256',
};
const cases = [
  { label: 'image_create', input: { ...base, IfNoneMatch: '*', Body: Buffer.from('synthetic-image') } },
  { label: 'marker_create', input: { ...base, IfNoneMatch: '*', Body: Buffer.alloc(0) } },
  { label: 'marker_replace', input: { ...base, IfMatch: '"observed-image-etag"', Body: Buffer.alloc(0) } },
];
for (const { input } of cases) {
  const output = await client.send(new PutObjectCommand(input));
  const request = requests.at(-1);
  assert.equal(output.$metadata.attempts, 1);
  assert.equal(request.headers['if-none-match'], input.IfNoneMatch);
  assert.equal(request.headers['if-match'], input.IfMatch);
  assert.equal(request.headers['x-amz-meta-lyra-protocol'], 'state-copy-v2');
  assert.equal(request.headers['x-amz-meta-lyra-attempt'], 'opaque-attempt');
  assert.equal(request.method, 'PUT');
}
status = 503;
const before = requests.length;
await assert.rejects(client.send(new PutObjectCommand(cases[0].input)));
assert.equal(requests.length - before, 1);
assert.equal(await client.config.maxAttempts(), 1);
client.destroy();
console.log(JSON.stringify({
  checks_passed: 5,
  checks: [...cases.map((entry) => entry.label), 'single_attempt_on_503', 'explicit_max_attempts'],
  synthetic_handler_calls: requests.length,
  external_requests: 0,
  warning: 'Serializer behavior only; not proof of real S3 conditional/policy compatibility',
}, null, 2));
