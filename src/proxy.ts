import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export default clerkMiddleware((_auth, req) => {
  // Local development workaround:
  // some proxy setups break Clerk's localhost rewrite flow and cause ECONNRESET loops.
  if (process.env.NODE_ENV === 'development') {
    const host = req.nextUrl.hostname;
    if (host === '127.0.0.1' || host === 'localhost') {
      return NextResponse.next();
    }
  }

  // In production, enforce route-level authorization in pages and APIs.
});

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
