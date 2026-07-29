import { describe, expect, it } from 'vitest';

import { readInvitationTokenFromPath } from '../../../apps/web/src/lib/invitationPath.js';

describe('Web招待URL parser', () => {
  it('canonicalな/invitations/{token}をMobile App LinkのWeb fallbackとして受け入れる', () => {
    expect(readInvitationTokenFromPath('/invitations/token%2D123')).toBe('token-123');
  });

  it('既存メールの/invite/{token}も後方互換で受け入れる', () => {
    expect(readInvitationTokenFromPath('/invite/legacy-token/')).toBe('legacy-token');
  });

  it('空token、追加path、壊れたpercent encodingを拒否する', () => {
    expect(readInvitationTokenFromPath('/invitations/')).toBeNull();
    expect(readInvitationTokenFromPath('/invitations/token/extra')).toBeNull();
    expect(readInvitationTokenFromPath('/invitations/%E0%A4%A')).toBeNull();
  });
});
