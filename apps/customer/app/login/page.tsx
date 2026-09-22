"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { customerAuthApi } from "@/lib/api";
import { OAuthButtons } from "@/components/OAuthButtons";

// US-C-01: email + password, or Google/Apple — never phone. This is an
// opt-in destination someone navigates to, never a wall in front of
// browsing/cart/checkout (brief §3.1b).
export default function LoginPage() {
  const router = useRouter();
  const { save } = useAuthSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const session = await customerAuthApi.login({ email, password });
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
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, not vendor-supplied */}
      <img src="/logo-wordmark.png" alt="CloseBuy" className="h-10 w-auto" />
      <h1 className="text-2xl font-bold text-ink">Sign in</h1>

      <div className="flex w-full max-w-xs flex-col gap-4">
        <OAuthButtons />

        <div className="flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-gray-200" />
          or
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          <Link href="/forgot-password" className="-mt-2 text-xs text-muted underline">
            Forgot password?
          </Link>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted">
          New here?{" "}
          <Link href="/register" className="font-medium text-primary underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
