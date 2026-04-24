import { redirect } from 'next/navigation';

export default async function LegacyAvatarManagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/avatar/${id}`);
}
