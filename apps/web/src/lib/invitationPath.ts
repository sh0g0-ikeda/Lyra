const INVITATION_PATH_PATTERN = /^\/(?:invite|invitations)\/([^/]+)\/?$/u;
const MAX_INVITATION_TOKEN_LENGTH = 2_048;

export function readInvitationTokenFromPath(pathname: string): string | null {
  const match = pathname.match(INVITATION_PATH_PATTERN);
  if (match === null) {
    return null;
  }

  try {
    const token = decodeURIComponent(match[1]).trim();
    return token.length > 0 &&
      token.length <= MAX_INVITATION_TOKEN_LENGTH &&
      !token.includes('/')
      ? token
      : null;
  } catch {
    return null;
  }
}
