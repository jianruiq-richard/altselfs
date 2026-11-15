import { loadMarketingAccount } from '@/lib/marketing/account';
import { renderGuidancePage } from '@/lib/marketing/render';

export const dynamic = 'force-dynamic';

export async function GET() {
  const account = await loadMarketingAccount();
  return new Response(renderGuidancePage(account), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}
