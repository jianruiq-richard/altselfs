const DEFAULT_ALLOWED_EMAILS = ['jianruiq@gmail.com'];

function allowedEmails() {
  const configured = process.env.NEXT_PUBLIC_PRODUCT_INTELLIGENCE_ALLOWED_EMAILS
    ?.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return new Set(configured?.length ? configured : DEFAULT_ALLOWED_EMAILS);
}

export function hasProductIntelligenceAccess(email: string | null | undefined) {
  const normalizedEmail = email?.trim().toLowerCase();
  return Boolean(normalizedEmail && allowedEmails().has(normalizedEmail));
}
