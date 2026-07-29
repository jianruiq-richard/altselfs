import { WorkspaceLayoutClient } from '@/components/workspace-layout-client';

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkspaceLayoutClient>{children}</WorkspaceLayoutClient>;
}
