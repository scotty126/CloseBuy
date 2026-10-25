"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, useAuthSession, AuthShell, AuthDivider } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { customerAuthApi } from "@/lib/api";
import { OAuthButtons } from "@/components/OAuthButtons";
import { MonoArrow } from "@/components/MonoArrow";

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
    <AuthShell app="customer" route="login" title="Sign in" subtitle="Welcome back, neighbour.">
      <div className="flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Email"
            name="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Password"
            labelAside={
              <Link href="/forgot-password" className="text-[13px] text-ink underline underline-offset-[3px]">
                Forgot?
              </Link>
            }
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
            required
          />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"} <MonoArrow />
          </Button>
        </form>

        <AuthDivider />
        <OAuthButtons />

        <p className="text-center text-[13px] text-muted">
          New to CloseBuy?{" "}
          <Link href="/register" className="font-medium text-ink underline underline-offset-[3px]">
            Create an account
          </Link>
        </p>

        <p className="text-center text-xs text-muted">
          <Link href="/terms" className="underline">Terms of Service</Link> ·{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>
        </p>
      </div>
    </AuthShell>
  );
}
