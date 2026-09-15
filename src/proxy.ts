import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { buildLegacyWorkspaceRedirect, buildSignedInHomepageRedirect } from '@/lib/homepage-redirect';

export default clerkMiddleware(
  async (auth, req) => {
    const redirectUrl = buildLegacyWorkspaceRedirect(req.nextUrl);
    if (redirectUrl) return NextResponse.redirect(redirectUrl, 308);

    // Preserve the existing local Clerk workaround: auth() can cause a localhost rewrite loop.
    if (process.env.NODE_ENV === 'development' && ['localhost', '127.0.0.1'].includes(req.nextUrl.hostname)) {
      return NextResponse.next();
    }

    if (req.nextUrl.pathname === '/') {
      const { userId } = await auth();
      const destination = buildSignedInHomepageRedirect(req.nextUrl, userId);
      if (destination) {
        const response = NextResponse.redirect(destination);
        response.headers.set('Cache-Control', 'private, no-store');
        return response;
      }
    }

    // Authorization remains enforced close to the protected pages and APIs.
    return NextResponse.next();
  },
  {
    frontendApiProxy: {
      enabled: (url) => url.hostname.endsWith('.vercel.app'),
    },
  },
);

export const config = {
  matcher: [
    '/((?!.+\\.[\\w]+$|_next).*)',
    '/',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};
