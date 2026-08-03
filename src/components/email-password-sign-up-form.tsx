"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { useSignUp } from "@clerk/nextjs/legacy";
import { ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import styles from "./astromar-auth.module.css";

const DEFAULT_AUTH_REDIRECT = "/dashboard/setup?role=investor";

type ClerkErrorDetail = {
  code?: string;
  longMessage?: string;
  message?: string;
};

type ClerkErrorResponse = {
  errors?: ClerkErrorDetail[];
};

const PASSWORD_ERROR_CODES = new Set([
  "form_password_length_too_short",
  "form_password_length_too_long",
  "form_password_not_strong_enough",
  "form_password_pwned",
  "form_password_validation_failed",
]);

function getFirstError(error: unknown): ClerkErrorDetail | null {
  if (typeof error !== "object" || error === null || !("errors" in error)) {
    return null;
  }

  const errors = (error as ClerkErrorResponse).errors;
  return Array.isArray(errors) ? errors[0] ?? null : null;
}

function isPasswordError(error: ClerkErrorDetail | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = `${error.message ?? ""} ${error.longMessage ?? ""}`.toLowerCase();
  return PASSWORD_ERROR_CODES.has(code) || code.includes("password") || message.includes("password");
}

function getErrorMessage(error: unknown, fallback: string): string {
  const detail = getFirstError(error);
  if (detail) return detail.longMessage || detail.message || fallback;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function EmailPasswordSignUpForm() {
  const router = useRouter();
  const clerk = useClerk();
  const { isLoaded, signUp, setActive } = useSignUp();
  const [step, setStep] = useState<"credentials" | "verification">("credentials");
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showPasswordRules, setShowPasswordRules] = useState(false);

  async function completeSignUp(sessionId: string | null) {
    if (!sessionId) {
      setError("Your account was created, but the session could not be started. Please sign in.");
      return;
    }

    await setActive?.({
      session: sessionId,
      navigate: async ({ decorateUrl }) => {
        const destination = decorateUrl(DEFAULT_AUTH_REDIRECT);
        if (destination.startsWith("http")) {
          window.location.assign(destination);
          return;
        }
        router.replace(destination);
      },
    });
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !signUp || isSubmitting) return;

    setError("");
    setShowPasswordRules(false);

    if (!emailAddress.trim()) {
      setError("Enter your email address.");
      return;
    }

    if (!password) {
      setError("Enter a password.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signUp.create({
        emailAddress: emailAddress.trim(),
        password,
      });

      if (result.status === "complete") {
        await completeSignUp(result.createdSessionId);
        return;
      }

      if (result.unverifiedFields?.includes("email_address")) {
        await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
        setStep("verification");
        return;
      }

      setError("Additional account information is required. Please try again or use Google.");
    } catch (submitError) {
      const detail = getFirstError(submitError);
      if (isPasswordError(detail)) {
        setShowPasswordRules(true);
        setError("");
      } else {
        setError(getErrorMessage(submitError, "We could not create your account. Please try again."));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !signUp || isSubmitting) return;

    setError("");
    if (!verificationCode.trim()) {
      setError("Enter the verification code from your email.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: verificationCode.trim(),
      });

      if (result.status === "complete") {
        await completeSignUp(result.createdSessionId);
        return;
      }

      setError("Email verification is not complete. Check the code and try again.");
    } catch (verificationError) {
      setError(getErrorMessage(verificationError, "The verification code is invalid or has expired."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resendVerificationCode() {
    if (!isLoaded || !signUp || isSubmitting) return;
    setError("");
    setIsSubmitting(true);
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    } catch (resendError) {
      setError(getErrorMessage(resendError, "We could not resend the code. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function restart() {
    if (isSubmitting) return;
    clerk.client.resetSignUp();
    setStep("credentials");
    setVerificationCode("");
    setError("");
  }

  async function continueWithGoogle() {
    if (!isLoaded || !signUp || isSubmitting) return;
    setError("");
    setIsSubmitting(true);
    try {
      await signUp.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: DEFAULT_AUTH_REDIRECT,
      });
    } catch (oauthError) {
      setError(getErrorMessage(oauthError, "Google sign-up could not be started. Please try again."));
      setIsSubmitting(false);
    }
  }

  if (step === "verification") {
    return (
      <form className={styles.emailForm} onSubmit={submitVerification} noValidate>
        <button className={styles.authBackButton} type="button" onClick={restart} disabled={isSubmitting}>
          <ArrowLeft size={16} aria-hidden="true" />
          Change email
        </button>

        <div className={styles.verificationIntro}>
          <h2>Check your email</h2>
          <p>Enter the verification code sent to <strong>{emailAddress}</strong>.</p>
        </div>

        <div className={styles.phoneField}>
          <label htmlFor="email-verification-code">Verification code</label>
          <input
            id="email-verification-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={verificationCode}
            onChange={(event) => setVerificationCode(event.target.value)}
            disabled={isSubmitting}
            className={styles.phoneInput}
            placeholder="Enter code"
          />
        </div>

        {error ? <p className={styles.phoneError} role="alert">{error}</p> : null}

        <button type="submit" disabled={!isLoaded || isSubmitting} className={styles.phoneSubmit}>
          {isSubmitting ? "Verifying..." : "Verify email"}
          {!isSubmitting ? <ArrowRight size={17} aria-hidden="true" /> : null}
        </button>

        <button
          className={styles.authTextButton}
          type="button"
          onClick={resendVerificationCode}
          disabled={isSubmitting}
        >
          Resend code
        </button>
      </form>
    );
  }

  return (
    <div className={styles.emailForm}>
      <button
        className={styles.googleButton}
        type="button"
        onClick={continueWithGoogle}
        disabled={!isLoaded || isSubmitting}
      >
        <span className={styles.googleMark} aria-hidden="true">G</span>
        Continue with Google
      </button>

      <div className={styles.authDivider}><span>or</span></div>

      <form className={styles.emailForm} onSubmit={submitCredentials} noValidate>
        <div className={styles.phoneField}>
          <label htmlFor="sign-up-email">Email address</label>
          <input
            id="sign-up-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={emailAddress}
            onChange={(event) => setEmailAddress(event.target.value)}
            disabled={isSubmitting}
            className={styles.phoneInput}
            placeholder="you@company.com"
          />
        </div>

        <div className={styles.phoneField}>
          <label htmlFor="sign-up-password">Password</label>
          <div className={styles.passwordInputWrap}>
            <input
              id="sign-up-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
              className={styles.phoneInput}
              placeholder="Create a password"
            />
            <button
              className={styles.passwordVisibilityButton}
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {showPasswordRules ? (
          <div className={styles.passwordRules} role="alert">
            <strong>Choose a stronger password</strong>
            <ul>
              <li>Use at least 10 characters.</li>
              <li>Include uppercase and lowercase letters, a number, and a symbol.</li>
              <li>Do not use your email address, name, or a common or breached password.</li>
            </ul>
          </div>
        ) : null}

        {error ? <p className={styles.phoneError} role="alert">{error}</p> : null}

        <div id="clerk-captcha" className={styles.clerkCaptcha} />

        <button type="submit" disabled={!isLoaded || isSubmitting} className={styles.phoneSubmit}>
          {isSubmitting ? "Creating account..." : "Create account"}
          {!isSubmitting ? <ArrowRight size={17} aria-hidden="true" /> : null}
        </button>
      </form>
    </div>
  );
}
