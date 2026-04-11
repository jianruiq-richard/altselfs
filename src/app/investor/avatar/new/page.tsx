import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { FigmaShell } from '@/components/figma-shell';
import MyDigitalTwinWorkbench from '@/components/my-digital-twin-workbench';
import type { AvatarItem } from '@/components/my-digital-twin-workbench';

export default async function MyDigitalTwinPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
    include: {
      avatars: {
        include: {
          chats: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      integrations: true,
      wechatSources: true,
    },
  });

  if (!dbUser || dbUser.role !== 'INVESTOR') {
    redirect('/dashboard');
  }

  const avatarCount = dbUser.avatars.length;
  const totalChats = dbUser.avatars.reduce((sum, avatar) => sum + avatar.chats.length, 0);
  const totalTokens = avatarCount * 2400 + totalChats * 320 + dbUser.integrations.length * 450 + dbUser.wechatSources.length * 180;

  const completionSeed = [
    avatarCount > 0 ? 20 : 0,
    dbUser.integrations.length > 0 ? 15 : 0,
    dbUser.wechatSources.length > 0 ? 15 : 0,
    dbUser.nickname ? 10 : 0,
    dbUser.phone ? 10 : 0,
    dbUser.wechatId ? 10 : 0,
    totalChats > 0 ? 20 : 0,
  ].reduce((a, b) => a + b, 0);
  const totalCompletion = Math.max(20, Math.min(96, completionSeed));

  const avatars: AvatarItem[] = dbUser.avatars.map((avatar) => ({
    id: avatar.id,
    name: avatar.name,
    status: avatar.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    chatsCount: avatar.chats.length,
  }));

  return (
    <FigmaShell homeHref="/investor" title="我的数字分身" subtitle="不断充实你的数字分身，让它越来越懂你">
      <MyDigitalTwinWorkbench
        avatarCount={avatarCount}
        totalChats={totalChats}
        totalTokens={totalTokens}
        totalCompletion={totalCompletion}
        avatars={avatars}
      />
    </FigmaShell>
  );
}
