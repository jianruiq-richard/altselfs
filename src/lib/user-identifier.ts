const FALLBACK_EMAIL_DOMAIN = 'users.altselfs.local';

export function buildFallbackEmail(clerkId: string): string {
  const safeId = clerkId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safeId}@${FALLBACK_EMAIL_DOMAIN}`;
}

export function isFallbackEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.endsWith(`@${FALLBACK_EMAIL_DOMAIN}`);
}

export function displayEmail(email: string | null | undefined): string {
  if (!email || isFallbackEmail(email)) {
    return '未绑定邮箱';
  }
  return email;
}
