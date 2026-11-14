import { saveAccountAnalytics } from '@/lib/analytics/attribution';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { identifyPostHogUser } from '@/lib/analytics/posthog';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId: clerkId, sessionId } = await auth();
  if (!clerkId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: {
      id: true,
      role: true,
      registrationSessionId: true,
      registrationReportedAt: true,
      creditSubscription: { select: { planKey: true } },
    },
  });
  if (!user) return Response.json({ error: 'User context is not ready' }, { status: 404 });

  return Response.json({
    userId: user.id,
    role: user.role,
    registrationPending: Boolean(sessionId && user.registrationSessionId === sessionId && !user.registrationReportedAt),
    planKey: user.creditSubscription?.planKey || 'FREE',
  });
}

// Authenticated account binding; campaign data cannot choose a target account.
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return Response.json({error:'Forbidden'}, {status:403});
  const { userId: clerkId } = await auth();
  if (!clerkId) return Response.json({error:'Unauthorized'}, {status:401});
  const user = await prisma.user.findUnique({where:{clerkId}, select:{id:true}});
  if (!user) return Response.json({error:'User context is not ready'}, {status:404});
  const text = await request.text();
  if (text.length > 8192) return Response.json({error:'Payload too large'}, {status:413});
  let body: unknown;
  try { body = JSON.parse(text); } catch { return Response.json({error:'Invalid JSON'}, {status:400}); }
  await saveAccountAnalytics(prisma, user.id, body);
  const posthogDistinctId = body && typeof body === 'object'
    ? (body as Record<string, unknown>).posthogDistinctId
    : null;
  await identifyPostHogUser(user.id, posthogDistinctId);
  return Response.json({saved:true}, {headers:{'Cache-Control':'no-store'}});
}
