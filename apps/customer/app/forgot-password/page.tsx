"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Input } from "@closebuy/ui";
import { customerAuthApi } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await customerAuthApi.forgotPassword({ email });
    } finally {
      // Always shows the same confirmation, whether or not the email
      // exists (US-C-01) — the API never reveals that either.
      setIsSubmitting(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-bold text-primary">Check your email</h1>
        <p className="max-w-xs text-sm text-muted">
          If an account exists for {email}, a reset link is on its way.
        </p>
        <Link href="/login" className="text-sm font-medium text-primary underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-2xl font-bold text-primary">Reset your password</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-4">
        <Input
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send reset link"}
        </Button>
        <Link href="/login" className="text-center text-xs text-muted underline">
          Back to sign in
        </Link>
      </form>
    </div>
  );
}
