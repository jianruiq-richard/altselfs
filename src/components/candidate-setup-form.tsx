'use client';

import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { productBrand } from '@/lib/brand';
import { buildFallbackEmail } from '@/lib/user-identifier';

export function CandidateSetupForm() {
  const { isLoaded, user } = useUser();
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [wechatId, setWechatId] = useState('');

  useEffect(() => {
    const primaryPhone = user?.primaryPhoneNumber?.phoneNumber;
    if (primaryPhone) setPhone((current) => current || primaryPhone);
  }, [user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    if (!nickname.trim() || !phone.trim() || !wechatId.trim()) {
      setError('Please enter your display name, phone number, and WeChat ID.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/user/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:
            user.primaryEmailAddress?.emailAddress ||
            user.emailAddresses[0]?.emailAddress ||
            buildFallbackEmail(user.id),
          name: user.fullName,
          role: 'CANDIDATE',
          nickname: nickname.trim(),
          phone: phone.trim(),
          wechatId: wechatId.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Failed to save settings. Please try again.');
        return;
      }

      router.replace('/candidate');
      router.refresh();
    } catch (saveError) {
      console.error('Candidate setup failed:', saveError);
      setError('Network error. Please try again later.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-[#090a0a] px-5 py-10 text-zinc-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-white/10 bg-[#121313] p-7 shadow-2xl shadow-black/30"
      >
        <p className="text-xs font-semibold uppercase text-zinc-500">{productBrand.name}</p>
        <h1 className="mt-3 text-2xl font-semibold">Complete your profile</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Add the contact details required for candidate conversations.
        </p>

        <div className="mt-7 space-y-4">
          <SetupField
            label="Display name"
            value={nickname}
            onChange={setNickname}
            placeholder="Display name"
          />
          <SetupField
            label="Phone"
            value={phone}
            onChange={setPhone}
            placeholder="Phone number"
            type="tel"
          />
          <SetupField
            label="WeChat ID"
            value={wechatId}
            onChange={setWechatId}
            placeholder="WeChat ID"
          />
        </div>

        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

        <button
          type="submit"
          disabled={!isLoaded || !user || isSaving}
          className="mt-6 w-full rounded-md bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Continue'}
        </button>
      </form>
    </main>
  );
}

function SetupField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: 'text' | 'tel';
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required
        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500"
      />
    </label>
  );
}
