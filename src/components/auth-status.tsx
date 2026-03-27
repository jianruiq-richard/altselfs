'use client';

import { SignOutButton } from '@clerk/nextjs';
import Link from 'next/link';

type AuthStatusProps = {
  imageUrl: string;
  displayName: string;
  roleLabel: string;
};

export default function AuthStatus({ imageUrl, displayName, roleLabel }: AuthStatusProps) {
  return (
    <div className="flex items-center gap-3">
      <Link href="/profile" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
        <div className="w-8 h-8 rounded-full overflow-hidden bg-slate-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={displayName}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="text-sm">
          <p className="text-slate-900 font-medium leading-none">{displayName}</p>
          <p className="text-slate-500 mt-1 leading-none">{roleLabel}</p>
        </div>
      </Link>
      <SignOutButton redirectUrl="/">
        <button
          type="button"
          className="text-sm text-slate-600 hover:text-slate-900 border border-slate-300 rounded-md px-2 py-1"
        >
          退出
        </button>
      </SignOutButton>
    </div>
  );
}
