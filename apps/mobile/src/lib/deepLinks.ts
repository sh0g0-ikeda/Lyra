export type MobileLink =
  | { type: 'auth-callback' }
  | { type: 'auth-logout' };

const MOBILE_SCHEME = 'lyra-mobile:';
const AUTH_HOST = 'auth';

export const parseMobileLink = (rawUrl: string): MobileLink | null => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== MOBILE_SCHEME || url.hostname !== AUTH_HOST) {
      return null;
    }
    if (url.pathname === '/callback') {
      return { type: 'auth-callback' };
    }
    if (url.pathname === '/logout') {
      return { type: 'auth-logout' };
    }
    return null;
  } catch {
    return null;
  }
};
