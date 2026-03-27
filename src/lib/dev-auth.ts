// Development authentication utilities
// This file provides mock authentication for development purposes

export const isDemoMode = process.env.NODE_ENV === 'development' &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.includes('demo-key');

// Mock user for development
export const mockUser = {
  id: 'demo-user-id',
  emailAddresses: [{ emailAddress: 'demo@example.com' }],
  fullName: 'Demo User',
};

// Mock current user function
export async function getCurrentUserDev() {
  if (isDemoMode) {
    return mockUser;
  }
  return null;
}