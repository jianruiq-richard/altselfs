export type LandingAccount = { name: string; imageUrl: string | null };

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function renderLandingAccount(account: LandingAccount | null) {
  if (!account) return '<a class="btn quiet login-link" href="/sign-in?redirect_url=/account">Log in</a>';
  const initial = Array.from(account.name.trim())[0] || 'M';
  const image = account.imageUrl && /^https:\/\//i.test(account.imageUrl)
    ? `<img src="${escape(account.imageUrl)}" alt="" width="28" height="28" referrerpolicy="no-referrer">`
    : '';
  return `<a class="btn quiet account-link" href="/account" aria-label="My account"><span class="account-avatar" aria-hidden="true"><span>${escape(initial.toUpperCase())}</span>${image}</span><span>My account</span></a>`;
}
