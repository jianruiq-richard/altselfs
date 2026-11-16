import { loadMarketingAccount } from '@/lib/marketing/account';
import { renderQwen4MaxPage } from '@/lib/marketing/qwen4-max';

export const dynamic = 'force-dynamic';

export async function GET() {
  const account = await loadMarketingAccount();
  return new Response(renderQwen4MaxPage(account), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}
