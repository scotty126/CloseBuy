"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import { customerAuthApi } from "@/lib/api";

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await customerAuthApi.resetPassword({ token, newPassword });
      router.push("/login");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "This link may have expired — request a new one.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return <p className="text-center text-sm text-muted">This reset link is missing its token.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-4">
      <Input
        label="New password"
        name="newPassword"
        type="password"
        minLength={8}
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        error={error ?? undefined}
        required
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-2xl font-bold text-primary">Set a new password</h1>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
