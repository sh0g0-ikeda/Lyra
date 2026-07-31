import { describe, expect, it } from 'vitest';
import { storyQueryKeys } from '../src/lib/storyQueryKeys';

describe('story query keys', () => {
  it('sessionとpersonal・organization scopeをcache keyで分離する', () => {
    const personal = storyQueryKeys('session-a', null);
    const organization = storyQueryKeys(
      'session-a',
      '99999999-9999-4999-8999-999999999999',
    );
    const anotherSession = storyQueryKeys('session-b', null);

    expect(personal.works()).not.toEqual(organization.works());
    expect(personal.works()).not.toEqual(anotherSession.works());
    expect(organization.episodes('chapter-1')).toEqual([
      'mobile-story',
      'session-a',
      'organization:99999999-9999-4999-8999-999999999999',
      'episodes',
      'chapter-1',
    ]);
    expect(organization.scenes('episode-1')).toEqual([
      'mobile-story',
      'session-a',
      'organization:99999999-9999-4999-8999-999999999999',
      'scenes',
      'episode-1',
    ]);
    expect(organization.pages('episode-1')).toEqual([
      'mobile-story',
      'session-a',
      'organization:99999999-9999-4999-8999-999999999999',
      'pages',
      'episode-1',
    ]);
    expect(organization.jobs()).toEqual([
      'mobile-story',
      'session-a',
      'organization:99999999-9999-4999-8999-999999999999',
      'jobs',
    ]);
    expect(organization.job('job-1')).toEqual([
      'mobile-story',
      'session-a',
      'organization:99999999-9999-4999-8999-999999999999',
      'job',
      'job-1',
    ]);
  });
});
