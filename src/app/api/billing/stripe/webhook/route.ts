import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return Response.json({ error: 'Stripe-Signature is required.' }, { status: 400 });
  const rawBody = await request.arrayBuffer();
  try {
    const result = await personalAgentInternalFetch(
      '/internal/billing/stripe/webhook',
      {
        method: 'POST',
        headers: {
          'content-type': request.headers.get('content-type') || 'application/json',
          'stripe-signature': signature,
        },
        body: rawBody,
      },
      { attempts: 1, timeoutMs: 25_000 },
    );
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Webhook processing failed.' },
      { status: 502 },
    );
  }
}
