"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { authApi } from "@/lib/api";

// US-C-01: phone + OTP, no email/password. This is the one flow that has
// to actually work end to end for M0 to be done — see roadmap.md M0.
export default function LoginPage() {
  const router = useRouter();
  const { save } = useAuthSession();

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await authApi.requestOtp({ phone });
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
      const session = await authApi.verifyOtp({ phone, code, role: "customer" });
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
      <h1 className="text-2xl font-bold text-primary">CloseBuy</h1>

      {step === "phone" ? (
        <form onSubmit={handleRequestOtp} className="flex w-full max-w-xs flex-col gap-4">
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
            {isSubmitting ? "Sending code…" : "Send code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="flex w-full max-w-xs flex-col gap-4">
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
          <button
            type="button"
            className="text-xs text-muted underline"
            onClick={() => setStep("phone")}
          >
            Use a different number
          </button>
        </form>
      )}
    </div>
  );
}
