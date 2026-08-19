import productionRedirectContract from '../../productionRedirectContract.json';

export type MobileLink =
  | { type: 'auth-callback' }
  | { type: 'auth-logout' }
  | { type: 'invitation'; token: string };

const productionOrigin = productionRedirectContract.universalLink.origin;
const maxInvitationTokenLength = 2048;

export const parseMobileLink = (rawUrl: string): MobileLink | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    url.protocol === 'lyra-mobile:' &&
    url.hostname === 'auth' &&
    (url.pathname === '/callback' || url.pathname === '/logout')
  ) {
    return { type: url.pathname === '/callback' ? 'auth-callback' : 'auth-logout' };
  }

  if (url.origin !== productionOrigin) {
    return null;
  }

  if (url.pathname === productionRedirectContract.universalLink.callbackPath) {
    return { type: 'auth-callback' };
  }
  if (url.pathname === productionRedirectContract.universalLink.logoutPath) {
    return { type: 'auth-logout' };
  }

  const invitationMatch = /^\/invitations\/([^/]+)$/u.exec(url.pathname);
  if (invitationMatch === null) {
    return null;
  }

  let token: string;
  try {
    token = decodeURIComponent(invitationMatch[1] ?? '').trim();
  } catch {
    return null;
  }
  if (
    token.length === 0 ||
    token.length > maxInvitationTokenLength ||
    token.includes('/')
  ) {
    return null;
  }

  return { type: 'invitation', token };
};
