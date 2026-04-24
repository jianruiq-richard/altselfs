import { redirect } from 'next/navigation';

export default async function LegacyAvatarChatDetailPage({
  params,
}: {
  params: Promise<{ id: string; chatId: string }>;
}) {
  const { id, chatId } = await params;
  redirect(`/avatar/${id}/chat/${chatId}`);
}
