"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { ArrowRight } from "lucide-react";
import styles from "./astromar-auth.module.css";

type PhonePasswordAuthFormProps = {
  mode: "sign-in" | "sign-up";
  redirectUrl?: string;
};

const COUNTRY_CODES = [
  { code: "+1", label: "United States / Canada +1" },
  { code: "+44", label: "United Kingdom +44" },
  { code: "+61", label: "Australia +61" },
  { code: "+65", label: "Singapore +65" },
  { code: "+81", label: "Japan +81" },
  { code: "+82", label: "South Korea +82" },
  { code: "+852", label: "Hong Kong +852" },
  { code: "+853", label: "Macau +853" },
  { code: "+886", label: "Taiwan +886" },
  { code: "+86", label: "China +86" },
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
    return first?.longMessage || first?.message || "Authentication failed. Please try again.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Authentication failed. Please try again.";
}

export function PhonePasswordAuthForm({ mode, redirectUrl = "/dashboard" }: PhonePasswordAuthFormProps) {
  const router = useRouter();
  const { isLoaded: isSignInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: isSignUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const [countryCode, setCountryCode] = useState("+1");
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
      setError("Passwords do not match.");
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

        setError("Sign-in is not complete. Check your account settings and try again.");
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
        setError("Phone verification is required. Enable phone verification in Clerk before using this sign-up flow.");
        return;
      }

      setError("Sign-up is not complete. Check your Clerk sign-up settings and try again.");
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.phoneForm}>
      <div className={styles.phoneField}>
        <label htmlFor="phone-country">Phone number</label>
        <div className={styles.phoneRow}>
          <select
            id="phone-country"
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
            disabled={isSubmitting}
            className={styles.phoneSelect}
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
            className={styles.phoneInput}
            placeholder="(555) 123-4567"
          />
        </div>
      </div>

      <div className={styles.phoneField}>
        <label htmlFor="phone-password">Password</label>
        <input
          id="phone-password"
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
          className={styles.phoneInput}
          placeholder={mode === "sign-in" ? "Enter your password" : "Create a password"}
        />
      </div>

      {mode === "sign-up" ? (
        <div className={styles.phoneField}>
          <label htmlFor="phone-confirm-password">Confirm password</label>
          <input
            id="phone-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={isSubmitting}
            className={styles.phoneInput}
            placeholder="Re-enter your password"
          />
        </div>
      ) : null}

      {error ? <p className={styles.phoneError}>{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className={styles.phoneSubmit}
      >
        {isSubmitting ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
        {!isSubmitting ? <ArrowRight size={17} aria-hidden="true" /> : null}
      </button>
      <p className={styles.phoneFinePrint}>
        {mode === "sign-in"
          ? "Your workspace remains private and available across sessions."
          : "Phone verification may be required after account creation."}
      </p>
    </div>
  );
}
