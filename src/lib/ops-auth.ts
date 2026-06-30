import { currentUser } from '@clerk/nextjs/server';

export type OpsAdmin = {
  clerkId: string;
  email: string;
  name: string;
};

export async function requireOpsAdmin(): Promise<OpsAdmin | null> {
  const user = await currentUser();
  if (!user) return null;

  const email = (
    user.primaryEmailAddress?.emailAddress ||
    user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId)?.emailAddress ||
    user.emailAddresses[0]?.emailAddress ||
    ''
  ).toLowerCase();

  const allowedEmails = readCsvEnv('OPS_ADMIN_EMAILS').map((item) => item.toLowerCase());
  const allowedClerkIds = readCsvEnv('OPS_ADMIN_CLERK_IDS');
  const emailAllowed = allowedEmails.includes('*') || (email ? allowedEmails.includes(email) : false);
  const clerkAllowed = allowedClerkIds.includes('*') || allowedClerkIds.includes(user.id);

  if (!emailAllowed && !clerkAllowed) return null;

  return {
    clerkId: user.id,
    email,
    name: user.fullName || user.username || email || user.id,
  };
}

function readCsvEnv(key: string) {
  return (process.env[key] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
