const OAUTH_BLOCKED_EMBEDDED_BROWSER_RE =
  /MicroMessenger|WeChat|wxwork|FBAN|FBAV|Instagram|Line\/|Twitter|LinkedInApp|TikTok/i;

export function isOauthBlockedEmbeddedBrowser(userAgent: string | null | undefined): boolean {
  return OAUTH_BLOCKED_EMBEDDED_BROWSER_RE.test(userAgent ?? '');
}
