import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { resolveAuthCompletion } from '@/lib/analytics/auth-completion';

export async function POST(request: Request) {
  const { userId: clerkId, sessionId } = await auth();
  if (!clerkId || !sessionId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const input = await request.json().catch(() => null);
  if (input?.analyticsConsent !== 'granted') {
    return Response.json({ eventName: null });
  }
  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true, registrationSessionId: true },
  });
  if (!user) return Response.json({ error: 'User context is not ready' }, { status: 404 });
  const eventName = await resolveAuthCompletion(user, sessionId, input.hasPendingAuth === true, async () => {
    const claimed = await prisma.user.updateMany({
      where: { id: user.id, registrationSessionId: sessionId, registrationReportedAt: null },
      data: { registrationReportedAt: new Date() },
    });
    return claimed.count === 1;
  });
  return Response.json({ eventName });
}
