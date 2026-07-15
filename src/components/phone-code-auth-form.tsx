"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";

type PhonePasswordAuthFormProps = {
  mode: "sign-in" | "sign-up";
  redirectUrl?: string;
};

const COUNTRY_CODES = [
  { code: "+86", label: "content +86" },
  { code: "+1", label: "content / content +1" },
  { code: "+44", label: "content +44" },
  { code: "+61", label: "content +61" },
  { code: "+65", label: "content +65" },
  { code: "+81", label: "content +81" },
  { code: "+82", label: "content +82" },
  { code: "+852", label: "content +852" },
  { code: "+853", label: "content +853" },
  { code: "+886", label: "content +886" },
];

function buildE164Phone(countryCode: string, localNumber: string): string {
  const digits = localNumber.replace(/\D/g, "");
  const normalizedCode = countryCode.startsWith("+") ? countryCode : `+${countryCode}`;
  const countryDigits = normalizedCode.replace(/\D/g, "");

  if (digits.startsWith(countryDigits)) {
    return `+${digits}`;
  }

  return `${normalizedCode}${digits}`;
}

function getErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "errors" in error &&
    Array.isArray((error as { errors?: unknown[] }).errors)
  ) {
    const first = (error as { errors: Array<{ longMessage?: string; message?: string }> }).errors[0];
    return first?.longMessage || first?.message || "contentfailed, content.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "contentfailed, content.";
}

export function PhonePasswordAuthForm({ mode, redirectUrl = "/dashboard" }: PhonePasswordAuthFormProps) {
  const router = useRouter();
  const { isLoaded: isSignInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: isSignUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const [countryCode, setCountryCode] = useState("+86");
  const [localPhoneNumber, setLocalPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isLoaded = isSignInLoaded && isSignUpLoaded;
  const phoneDigits = localPhoneNumber.replace(/\D/g, "");
  const canSubmit =
    isLoaded &&
    phoneDigits.length > 0 &&
    password.length > 0 &&
    (mode === "sign-in" || confirmPassword.length > 0) &&
    !isSubmitting;

  async function submit() {
    if (!isLoaded || !signIn || !signUp) return;

    setError("");

    if (mode === "sign-up" && password !== confirmPassword) {
      setError("content.");
      return;
    }

    setIsSubmitting(true);
    const normalizedPhone = buildE164Phone(countryCode, localPhoneNumber);

    try {
      if (mode === "sign-in") {
        const result = await signIn.create({
          strategy: "password",
          identifier: normalizedPhone,
          password,
        });

        if (result.status === "complete" && result.createdSessionId) {
          await setSignInActive?.({ session: result.createdSessionId });
          router.push(redirectUrl);
          return;
        }

        setError("Sign inComplete, contentSettingscontent.");
        return;
      }

      const result = await signUp.create({
        phoneNumber: normalizedPhone,
        password,
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setSignUpActive?.({ session: result.createdSessionId });
        router.push(redirectUrl);
        return;
      }

      if (result.unverifiedFields?.includes("phone_number")) {
        setError("Clerk content.content Dashboard content Phone content Verify at sign-up content.");
        return;
      }

      setError("Sign upcontentComplete, content Clerk contentSign upSettings.");
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#ead8bd] bg-white p-5 shadow-sm">
      <div className="space-y-4">
        <div>
          <label htmlFor="phone-country" className="block text-sm font-medium text-stone-800">
            content
          </label>
          <div className="mt-2 grid grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] gap-2">
            <select
              id="phone-country"
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-lg border border-[#d8c8b5] bg-white px-3 py-3 text-sm text-stone-950 outline-none transition-colors focus:border-[#7a451f]"
            >
              {COUNTRY_CODES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.label}
                </option>
              ))}
            </select>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              value={localPhoneNumber}
              onChange={(event) => setLocalPhoneNumber(event.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-lg border border-[#d8c8b5] bg-white px-4 py-3 text-base text-stone-950 outline-none transition-colors placeholder:text-stone-400 focus:border-[#7a451f]"
              placeholder="138 0000 0000"
            />
          </div>
        </div>

        <div>
          <label htmlFor="phone-password" className="block text-sm font-medium text-stone-800">
            content
          </label>
          <input
            id="phone-password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            className="mt-2 w-full rounded-lg border border-[#d8c8b5] bg-white px-4 py-3 text-base text-stone-950 outline-none transition-colors placeholder:text-stone-400 focus:border-[#7a451f]"
            placeholder={mode === "sign-in" ? "content" : "SettingsSign in"}
          />
        </div>

        {mode === "sign-up" ? (
          <div>
            <label htmlFor="phone-confirm-password" className="block text-sm font-medium text-stone-800">
              content
            </label>
            <input
              id="phone-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={isSubmitting}
              className="mt-2 w-full rounded-lg border border-[#d8c8b5] bg-white px-4 py-3 text-base text-stone-950 outline-none transition-colors placeholder:text-stone-400 focus:border-[#7a451f]"
              placeholder="content"
            />
          </div>
        ) : null}

        {error ? <p className="text-sm leading-6 text-red-700">{error}</p> : null}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="w-full rounded-lg bg-[#7a451f] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#6b3c1b] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "content..." : mode === "sign-in" ? "sign in" : "contentSign up"}
        </button>
      </div>
    </div>
  );
}
