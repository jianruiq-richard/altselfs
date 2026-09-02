import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { buildSignedInHomepageRedirect } from '@/lib/homepage-redirect';

export default clerkMiddleware(
  async (auth, req) => {
    // Local development workaround:
    // some proxy setups break Clerk's localhost rewrite flow and cause ECONNRESET loops.
    if (process.env.NODE_ENV === 'development') {
      const host = req.nextUrl.hostname;
      if (host === '127.0.0.1' || host === 'localhost') {
        return NextResponse.next();
      }
    }

    if (req.nextUrl.pathname === '/') {
      const { userId } = await auth();
      const redirectUrl = buildSignedInHomepageRedirect(req.nextUrl, userId);

      if (redirectUrl) {
        const response = NextResponse.redirect(redirectUrl);
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
