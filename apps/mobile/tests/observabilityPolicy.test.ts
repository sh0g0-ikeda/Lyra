import { describe, expect, it } from 'vitest';

import {
  buildOperationalMetric,
  sanitizeCrashEvent,
  shouldEnableObservability,
  type ObservabilityBuildMetadata
} from '@/lib/observabilityPolicy';

const metadata: ObservabilityBuildMetadata = {
  buildNumber: '42',
  correlationId: 'MOB-SESSION-0123456789ABCDEF',
  release: 'com.lyra.mobile@1.2.3+42',
  updateId: 'update-1',
  version: '1.2.3'
};

describe('mobile observability privacy policy', () => {
  it('validated production buildとDSNが揃う場合だけ送信を有効化する', () => {
    expect(
      shouldEnableObservability({
        buildEnvironment: 'production',
        configValid: true,
        sentryDsn: 'https://public@example.ingest.sentry.io/123456'
      })
    ).toBe(true);
    expect(
      shouldEnableObservability({
        buildEnvironment: 'preview',
        configValid: true,
        sentryDsn: 'https://public@example.ingest.sentry.io/123456'
      })
    ).toBe(false);
    expect(
      shouldEnableObservability({
        buildEnvironment: 'production',
        configValid: false,
        sentryDsn: 'https://public@example.ingest.sentry.io/123456'
      })
    ).toBe(false);
  });

  it('許可したbuild情報とopaque support IDだけでmetricを構成する', () => {
    expect(
      buildOperationalMetric(
        {
          name: 'job_failure',
          jobId: '11111111-1111-4111-8111-111111111111',
          requestId: '22222222-2222-4222-8222-222222222222'
        },
        metadata
      )
    ).toEqual({
      level: 'warning',
      message: 'lyra.mobile.job_failure',
      tags: {
        build_number: '42',
        correlation_id: 'MOB-SESSION-0123456789ABCDEF',
        job_id: '11111111-1111-4111-8111-111111111111',
        metric: 'job_failure',
        release: 'com.lyra.mobile@1.2.3+42',
        request_id: '22222222-2222-4222-8222-222222222222',
        update_id: 'update-1',
        version: '1.2.3'
      }
    });
  });

  it('crash eventからPII、本文、request、breadcrumb、任意extraを除去する', () => {
    const sanitized = sanitizeCrashEvent(
      {
        breadcrumbs: [{ message: 'story text' }],
        contexts: {
          app: { app_name: 'Lyra Mobile' },
          custom: { dialogue: '秘密のセリフ' }
        },
        exception: {
          values: [
            {
              type: 'Error',
              value: 'author@example.test の秘密の本文',
              stacktrace: {
                frames: [
                  {
                    filename: 'StoryScreen.tsx',
                    function: 'saveStory',
                    lineno: 42,
                    vars: {
                      accessToken: 'secret-token',
                      story: '秘密の本文'
                    }
                  }
                ]
              }
            }
          ]
        },
        extra: {
          email: 'author@example.test',
          image: 'data:image/png;base64,secret',
          token: 'secret-token'
        },
        request: {
          data: 'story body',
          headers: { authorization: 'Bearer secret-token' },
          url: 'https://app.lyra-editor.com/api/works?name=secret'
        },
        tags: {
          arbitrary: 'must-not-pass',
          metric: 'job_failure'
        },
        user: {
          email: 'author@example.test',
          id: 'user-1',
          ip_address: '127.0.0.1'
        }
      },
      metadata
    );

    expect(sanitized).not.toHaveProperty('breadcrumbs');
    expect(sanitized).not.toHaveProperty('extra');
    expect(sanitized).not.toHaveProperty('request');
    expect(sanitized).not.toHaveProperty('user');
    expect(sanitized.contexts).toEqual({
      app: { app_name: 'Lyra Mobile' }
    });
    expect(JSON.stringify(sanitized.exception)).not.toContain('author@example.test');
    expect(JSON.stringify(sanitized.exception)).not.toContain('秘密の本文');
    expect(JSON.stringify(sanitized.exception)).not.toContain('secret-token');
    expect(sanitized.exception).toEqual({
      values: [
        {
          stacktrace: {
            frames: [
              {
                filename: 'StoryScreen.tsx',
                function: 'saveStory',
                lineno: 42
              }
            ]
          },
          type: 'Error'
        }
      ]
    });
    expect(sanitized.tags).toEqual({
      build_number: '42',
      correlation_id: 'MOB-SESSION-0123456789ABCDEF',
      release: 'com.lyra.mobile@1.2.3+42',
      update_id: 'update-1',
      version: '1.2.3'
    });
  });

  it('SDK contextもネストした許可fieldだけを残しdevice IDや名前を除去する', () => {
    const sanitized = sanitizeCrashEvent(
      {
        contexts: {
          app: {
            app_identifier: 'com.lyra.mobile',
            app_name: 'Lyra Mobile',
            app_version: '1.2.3',
            email: 'author@example.test',
          },
          device: {
            arch: 'arm64',
            family: 'Galaxy',
            id: 'device-unique-id',
            model: 'SM-S921',
            name: 'Shogo phone',
            simulator: false,
          },
          os: {
            name: 'Android',
            version: '16',
            username: 'shogo',
          },
          runtime: {
            name: 'Hermes',
            token: 'secret-token',
            version: '1.0',
          },
        },
      },
      metadata,
    );

    expect(sanitized.contexts).toEqual({
      app: {
        app_identifier: 'com.lyra.mobile',
        app_name: 'Lyra Mobile',
        app_version: '1.2.3',
      },
      device: {
        arch: 'arm64',
        family: 'Galaxy',
        model: 'SM-S921',
        simulator: false,
      },
      os: {
        name: 'Android',
        version: '16',
      },
      runtime: {
        name: 'Hermes',
        version: '1.0',
      },
    });
    expect(JSON.stringify(sanitized.contexts)).not.toContain('device-unique-id');
    expect(JSON.stringify(sanitized.contexts)).not.toContain('Shogo phone');
    expect(JSON.stringify(sanitized.contexts)).not.toContain('author@example.test');
    expect(JSON.stringify(sanitized.contexts)).not.toContain('secret-token');
  });

  it('event直下の識別子と種別も型とallowlistを満たす値だけ残す', () => {
    const safe = sanitizeCrashEvent(
      {
        event_id: '0123456789abcdef0123456789abcdef',
        level: 'error',
        platform: 'javascript',
        timestamp: 1_785_000_000,
      },
      metadata,
    );
    const unsafe = sanitizeCrashEvent(
      {
        event_id: 'author@example.test',
        level: '秘密の本文',
        platform: 'javascript author@example.test',
        timestamp: '2026-07-25 author@example.test',
      },
      metadata,
    );

    expect(safe).toMatchObject({
      event_id: '0123456789abcdef0123456789abcdef',
      level: 'error',
      platform: 'javascript',
      timestamp: 1_785_000_000,
    });
    expect(unsafe).not.toHaveProperty('event_id');
    expect(unsafe).not.toHaveProperty('level');
    expect(unsafe).not.toHaveProperty('platform');
    expect(unsafe).not.toHaveProperty('timestamp');
  });
});
