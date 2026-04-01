import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getInvestorOrNull } from '@/lib/investor-auth';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const investor = await getInvestorOrNull();
  if (!investor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: '缺少公众号ID' }, { status: 400 });
  }

  const existing = await prisma.investorWechatSource.findUnique({
    where: { id },
    select: { id: true, investorId: true },
  });

  if (!existing || existing.investorId !== investor.id) {
    return NextResponse.json({ error: '公众号不存在' }, { status: 404 });
  }

  await prisma.investorWechatSource.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
