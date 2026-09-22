"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { authApi } from "@/lib/api";
import { OAuthButtons } from "@/components/OAuthButtons";

const ROLE = "admin" as const;

/**
 * Phone+OTP or email+password, plus Google/Apple (OAuthButtons) — brief
 * §3.1b originally scoped staff sign-in to phone+OTP only, relaxed once
 * Termii turned out to be a real, months-long bottleneck. Both methods
 * land on the same session shape either way.
 */
export default function LoginPage() {
  const router = useRouter();
  const { save } = useAuthSession();

  const [method, setMethod] = useState<"phone" | "email">("phone");

  // Phone
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  // Email — sign-in only, no register toggle: admin accounts are
  // provisioned out of band only (email.ts's AdminSelfRegistrationDisabledError).
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await authApi.requestOtp({ phone, role: ROLE });
      if (res.session) {
        // Dev auto-signin (DEV_AUTO_SIGNIN_PHONES) — skips the code step
        // entirely, straight to a real session.
        save(res.session);
        router.push("/");
        return;
      }
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const session = await authApi.verifyOtp({ phone, code, role: ROLE });
      save(session);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const session = await authApi.staffLogin({ email, password, role: ROLE });
      save(session);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, not vendor-supplied */}
        <img src="/logo-wordmark.png" alt="CloseBuy" className="h-10 w-auto" />
        <p className="text-sm font-medium text-muted">Admin</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-4">
        <OAuthButtons />

        <div className="flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-gray-200" />
          or
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <div className="flex rounded-lg bg-surface p-1">
          <button
            type="button"
            onClick={() => {
              setMethod("phone");
              setError(null);
            }}
            className={toggleClass(method === "phone")}
          >
            Phone
          </button>
          <button
            type="button"
            onClick={() => {
              setMethod("email");
              setError(null);
            }}
            className={toggleClass(method === "email")}
          >
            Email
          </button>
        </div>

        {method === "phone" ? (
          step === "phone" ? (
            <form onSubmit={handleRequestOtp} className="flex flex-col gap-4">
              <Input
                label="Phone number"
                name="phone"
                type="tel"
                placeholder="+2348012345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                error={error ?? undefined}
                required
              />
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Sending code…" : "Continue"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
              <p className="text-sm text-muted">Enter the 6-digit code sent to {phone}</p>
              <Input
                label="Verification code"
                name="code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                error={error ?? undefined}
                required
              />
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Verifying…" : "Verify"}
              </Button>
              <button type="button" className="text-xs text-muted underline" onClick={() => setStep("phone")}>
                Use a different number
              </button>
            </form>
          )
        ) : (
          // No "create an account" toggle here — admin accounts are
          // provisioned out of band only (email.ts's
          // AdminSelfRegistrationDisabledError); this form only ever signs
          // an already-provisioned admin in.
          <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
            <Input
              label="Email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error ?? undefined}
              required
            />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function toggleClass(active: boolean): string {
  return `flex-1 rounded-md py-2 text-sm font-medium transition ${active ? "bg-white text-ink shadow-sm" : "text-muted"}`;
}
