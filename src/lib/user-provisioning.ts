import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildFallbackEmail } from '@/lib/user-identifier';

export type ProductUserRole = 'INVESTOR' | 'CANDIDATE';

export class ProductUserRoleConflictError extends Error {
  constructor() {
    super('Role is already fixed for this account and cannot be changed');
    this.name = 'ProductUserRoleConflictError';
  }
}

function deriveTwinDisplayBase(input: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  const name = String(input.name || '').trim();
  if (name) return name;

  const email = String(input.email || '').trim();
  if (email.includes('@')) {
    const prefix = email.split('@')[0]?.trim();
    if (prefix) return prefix;
  }

  return String(input.phone || '').trim();
}

function defaultTwinName(input: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  const base = deriveTwinDisplayBase(input);
  return base ? `${base}'s Digital Twin` : 'My Digital Twin';
}

const DEFAULT_TWIN_PROMPT =
  'You are my professional digital twin. Represent my background, preferences, and decision style faithfully. Ask clarifying questions when context is missing, stay concise, and avoid inventing facts.';

const DEFAULT_WECHAT_SOURCE_OWNER_EMAIL = 'jianruiq@163.com';

async function seedDefaultWechatSourcesForInvestor(investorId: string) {
  const templateUser = await prisma.user.findFirst({
    where: { email: DEFAULT_WECHAT_SOURCE_OWNER_EMAIL },
    select: {
      id: true,
      wechatSources: {
        select: {
          biz: true,
          displayName: true,
          description: true,
          lastArticleUrl: true,
          profile: true,
          profileUpdatedAt: true,
          profileConfidence: true,
          lastProfileEvidence: true,
          lastScannedAt: true,
        },
      },
    },
  });

  if (!templateUser || templateUser.id === investorId || templateUser.wechatSources.length === 0) {
    return;
  }

  await prisma.investorWechatSource.createMany({
    data: templateUser.wechatSources.map((source) => ({
      investorId,
      biz: source.biz,
      displayName: source.displayName,
      description: source.description,
      lastArticleUrl: source.lastArticleUrl,
      profileUpdatedAt: source.profileUpdatedAt,
      profileConfidence: source.profileConfidence,
      lastScannedAt: source.lastScannedAt,
      ...(source.profile === null ? {} : { profile: source.profile as Prisma.InputJsonValue }),
      ...(source.lastProfileEvidence === null
        ? {}
        : { lastProfileEvidence: source.lastProfileEvidence as Prisma.InputJsonValue }),
    })),
    skipDuplicates: true,
  });
}

async function ensureDefaultInvestorWorkspace(user: {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(849201, hashtext(${user.id}))`;

    const hasAvatar = await tx.avatar.findFirst({
      where: { investorId: user.id },
      select: { id: true },
    });

    if (!hasAvatar) {
      await tx.avatar.create({
        data: {
          investorId: user.id,
          name: defaultTwinName(user),
          description: 'Default digital twin created during account setup.',
          systemPrompt: DEFAULT_TWIN_PROMPT,
          status: 'ACTIVE',
        },
      });
    }
  });

  await seedDefaultWechatSourcesForInvestor(user.id);
}

export async function provisionProductUser(input: {
  clerkId: string;
  email?: string | null;
  name?: string | null;
  role: ProductUserRole;
  nickname?: string | null;
  phone?: string | null;
  wechatId?: string | null;
}) {
  const normalizedEmail = String(input.email || '').trim() || buildFallbackEmail(input.clerkId);
  const normalizedName = String(input.name || '').trim() || null;
  const nickname = String(input.nickname || '').trim() || null;
  const phone = String(input.phone || '').trim() || null;
  const wechatId = String(input.wechatId || '').trim() || null;

  if (input.role === 'CANDIDATE' && (!nickname || !phone || !wechatId)) {
    throw new Error('Candidate profile requires nickname, phone, and wechatId');
  }

  const existingUser = await prisma.user.findUnique({
    where: { clerkId: input.clerkId },
    select: { role: true },
  });
  if (existingUser && existingUser.role !== input.role) {
    throw new ProductUserRoleConflictError();
  }

  const user = await prisma.user.upsert({
    where: { clerkId: input.clerkId },
    create: {
      clerkId: input.clerkId,
      email: normalizedEmail,
      name: normalizedName,
      nickname: input.role === 'CANDIDATE' ? nickname : null,
      phone: input.role === 'CANDIDATE' ? phone : null,
      wechatId: input.role === 'CANDIDATE' ? wechatId : null,
      role: input.role,
    },
    update: {
      email: normalizedEmail,
      name: normalizedName,
      ...(input.role === 'CANDIDATE' ? { nickname, phone, wechatId } : {}),
    },
  });

  if (user.role !== input.role) {
    throw new ProductUserRoleConflictError();
  }

  if (input.role === 'INVESTOR') {
    await ensureDefaultInvestorWorkspace(user);
  }

  return user;
}
