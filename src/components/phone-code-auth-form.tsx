"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";

type FlowMode = "sign-in" | "sign-up";

function normalizeChinaPhone(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) {
    return trimmed.replace(/\s+/g, "");
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("86")) {
    return `+${digits}`;
  }
  return `+86${digits}`;
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

export function PhoneCodeAuthForm() {
  const router = useRouter();
  const { isLoaded: isSignInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: isSignUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const [phoneNumber, setPhoneNumber] = useState("+86");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<FlowMode>("sign-in");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isLoaded = isSignInLoaded && isSignUpLoaded;

  async function sendCode() {
    if (!isLoaded || !signIn || !signUp) return;

    setError("");
    setIsSubmitting(true);
    const normalizedPhone = normalizeChinaPhone(phoneNumber);
    setPhoneNumber(normalizedPhone);

    try {
      const signInAttempt = await signIn.create({ identifier: normalizedPhone });
      const phoneFactor = signInAttempt.supportedFirstFactors?.find(
        (factor) => factor.strategy === "phone_code",
      );

      if (phoneFactor?.strategy === "phone_code") {
        await signIn.prepareFirstFactor({
          strategy: "phone_code",
          phoneNumberId: phoneFactor.phoneNumberId,
        });
        setMode("sign-in");
        setStep("code");
        return;
      }

      throw new Error("当前账号未开启手机号验证码登录。");
    } catch (signInError) {
      try {
        await signUp.create({ phoneNumber: normalizedPhone });
        await signUp.preparePhoneNumberVerification({ strategy: "phone_code" });
        setMode("sign-up");
        setStep("code");
      } catch (signUpError) {
        setError(getErrorMessage(signUpError) || getErrorMessage(signInError));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyCode() {
    if (!isLoaded || !signIn || !signUp || !setSignInActive || !setSignUpActive) return;

    setError("");
    setIsSubmitting(true);

    try {
      if (mode === "sign-in") {
        const result = await signIn.attemptFirstFactor({
          strategy: "phone_code",
          code,
        });
        if (result.status === "complete" && result.createdSessionId) {
          await setSignInActive({ session: result.createdSessionId });
          router.push("/dashboard");
          return;
        }
      } else {
        const result = await signUp.attemptPhoneNumberVerification({ code });
        if (result.status === "complete" && result.createdSessionId) {
          await setSignUpActive({ session: result.createdSessionId });
          router.push("/dashboard");
          return;
        }
      }

      setError("验证码已提交，但登录尚未完成，请稍后重试。");
    } catch (verifyError) {
      setError(getErrorMessage(verifyError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#ead8bd] bg-white p-5 shadow-sm">
      <div className="space-y-4">
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-stone-800">
            中国手机号
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            disabled={step === "code" || isSubmitting}
            className="mt-2 w-full rounded-lg border border-[#d8c8b5] bg-white px-4 py-3 text-base text-stone-950 outline-none transition-colors placeholder:text-stone-400 focus:border-[#7a451f]"
            placeholder="+86 138 0000 0000"
          />
        </div>

        {step === "code" ? (
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-stone-800">
              短信验证码
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="mt-2 w-full rounded-lg border border-[#d8c8b5] bg-white px-4 py-3 text-base text-stone-950 outline-none transition-colors placeholder:text-stone-400 focus:border-[#7a451f]"
              placeholder="输入 6 位验证码"
            />
          </div>
        ) : null}

        {error ? <p className="text-sm leading-6 text-red-700">{error}</p> : null}

        {step === "phone" ? (
          <button
            type="button"
            onClick={sendCode}
            disabled={!isLoaded || isSubmitting}
            className="w-full rounded-lg bg-[#7a451f] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#6b3c1b] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "发送中..." : "发送验证码"}
          </button>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={verifyCode}
              disabled={!isLoaded || isSubmitting || code.trim().length === 0}
              className="w-full rounded-lg bg-[#7a451f] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#6b3c1b] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "验证中..." : "验证码登录"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setCode("");
                setError("");
              }}
              className="w-full rounded-lg border border-[#d8c8b5] px-4 py-3 text-sm font-medium text-stone-700 transition-colors hover:bg-[#fff4df]"
            >
              修改手机号
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
