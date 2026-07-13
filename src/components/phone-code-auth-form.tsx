"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";

type PhonePasswordAuthFormProps = {
  mode: "sign-in" | "sign-up";
  redirectUrl?: string;
};

const COUNTRY_CODES = [
  { code: "+86", label: "中国 +86" },
  { code: "+1", label: "美国 / 加拿大 +1" },
  { code: "+44", label: "英国 +44" },
  { code: "+61", label: "澳大利亚 +61" },
  { code: "+65", label: "新加坡 +65" },
  { code: "+81", label: "日本 +81" },
  { code: "+82", label: "韩国 +82" },
  { code: "+852", label: "中国香港 +852" },
  { code: "+853", label: "中国澳门 +853" },
  { code: "+886", label: "中国台湾 +886" },
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
    return first?.longMessage || first?.message || "操作失败，请稍后重试。";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "操作失败，请稍后重试。";
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
      setError("两次输入的密码不一致。");
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

        setError("登录尚未完成，请确认该手机号已设置密码。");
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
        setError("Clerk 当前仍要求手机号验证。请在 Dashboard 里关闭 Phone 的 Verify at sign-up 后再试。");
        return;
      }

      setError("注册尚未完成，请检查 Clerk 的手机号和密码注册设置。");
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
            手机号
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
            密码
          </label>
          <input
            id="phone-password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            className="mt-2 w-full rounded-lg border border-[#d8c8b5] bg-white px-4 py-3 text-base text-stone-950 outline-none transition-colors placeholder:text-stone-400 focus:border-[#7a451f]"
            placeholder={mode === "sign-in" ? "输入密码" : "设置登录密码"}
          />
        </div>

        {mode === "sign-up" ? (
          <div>
            <label htmlFor="phone-confirm-password" className="block text-sm font-medium text-stone-800">
              确认密码
            </label>
            <input
              id="phone-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={isSubmitting}
              className="mt-2 w-full rounded-lg border border-[#d8c8b5] bg-white px-4 py-3 text-base text-stone-950 outline-none transition-colors placeholder:text-stone-400 focus:border-[#7a451f]"
              placeholder="再次输入密码"
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
          {isSubmitting ? "提交中..." : mode === "sign-in" ? "手机号登录" : "手机号注册"}
        </button>
      </div>
    </div>
  );
}
