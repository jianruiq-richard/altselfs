import { InvestorAgentChatPage } from '@/components/investor-agent-chat-page';
import { WorkspaceRouteLoading } from '@/components/workspace-route-loading';
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense fallback={<WorkspaceRouteLoading label="Loading discussion" />}>
      <InvestorAgentChatPage />
    </Suspense>
  );
}
