type RegistrationUser = {
  id: string;
  registrationSessionId: string | null;
};

// The session is recorded only by the account INSERT, never by an update.
// A database claim prevents concurrent tabs from counting the registration twice.
export async function resolveAuthCompletion(
  user: RegistrationUser,
  sessionId: string,
  hasPendingAuth: boolean,
  claimRegistration: () => Promise<boolean>,
): Promise<'sign_up' | 'login' | null> {
  if (user.registrationSessionId === sessionId) {
    return await claimRegistration() ? 'sign_up' : null;
  }
  return hasPendingAuth ? 'login' : null;
}
