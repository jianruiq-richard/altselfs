'use client';

import { useUser } from '@clerk/nextjs';
import { InvestorAgentChatPage } from './investor-agent-chat-page';

export function HomepageWorkspace() {
  const { isSignedIn, user } = useUser();
  // Remount across authentication boundaries so personal state cannot remain in a guest view.
  return <InvestorAgentChatPage key={isSignedIn ? user.id : 'guest'} executive guest={!isSignedIn} />;
}
