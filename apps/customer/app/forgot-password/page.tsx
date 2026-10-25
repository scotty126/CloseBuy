"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Input, AuthShell } from "@closebuy/ui";
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
      <AuthShell app="customer" route="forgot-password" title="Check your email" subtitle={`If an account exists for ${email}, a reset link is on its way.`}>
        <Link href="/login" className="text-center text-sm text-muted">
          ← Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell app="customer" route="forgot-password" title="Forgot your password?" subtitle="Enter your email and we'll send a reset link.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          ← Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}
