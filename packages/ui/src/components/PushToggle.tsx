"use client";

import { useCallback, useEffect, useState } from "react";

/** The browser's `PushSubscription.toJSON()` shape — what the API's /notifications/subscribe takes as-is. */
export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushToggleApi {
  vapidKey: () => Promise<{ publicKey: string | null }>;
  subscribe: (subscription: PushSubscriptionPayload) => Promise<unknown>;
  unsubscribe: (endpoint: string) => Promise<unknown>;
}

type State =
  | "checking"
  | "hidden" // push isn't configured on the API — say nothing rather than offer a dead button
  | "unsupported" // this browser can't do web push at all
  | "needs-install" // iPhone/iPad Safari: push only works once added to the Home Screen
  | "blocked" // the user said "Block" — only they can undo that, in browser settings
  | "off"
  | "on";

// applicationServerKey wants raw bytes; the API serves the key as URL-safe base64.
function keyToBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/**
 * "Get alerts on this device" — registers the service worker, asks the
 * browser for permission, and hands the subscription to the API. Only
 * rendered inside a signed-in screen (the API routes need a session).
 *
 * `title`/`description` let the vendor and rider apps phrase it in their
 * own terms ("New order alerts") while customer and admin keep it generic.
 */
export function PushToggle({
  api,
  title = "Alerts on this device",
  description = "Get a notification when something changes, even with the app closed.",
  className = "",
}: {
  api: PushToggleApi;
  title?: string;
  description?: string;
  className?: string;
}) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const set = (s: State) => !cancelled && setState(s);
      try {
        if (isIos() && !isStandalone()) return set("needs-install");
        if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return set("unsupported");

        const { publicKey } = await api.vapidKey();
        if (!publicKey) return set("hidden");
        if (Notification.permission === "denied") return set("blocked");

        const reg = await navigator.serviceWorker.register("/sw.js");
        const existing = await reg.pushManager.getSubscription();
        set(existing && Notification.permission === "granted" ? "on" : "off");
      } catch {
        // A flaky network or a browser quirk here must not break the page this sits on.
        set("hidden");
      }
    })();
    return () => {
      cancelled = true;
    };
    // `api` is a module-level object in every app; deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turnOn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { publicKey } = await api.vapidKey();
      if (!publicKey) throw new Error("Alerts aren't available right now.");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) as BufferSource }));

      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("This browser gave an incomplete subscription.");
      await api.subscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
      setState("on");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't turn alerts on. Try again.");
    } finally {
      setBusy(false);
    }
  }, [api]);

  const turnOff = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        // Tell the API first: if that fails we still hold the subscription and the switch stays honest.
        await api.unsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Couldn't turn alerts off. Try again.");
    } finally {
      setBusy(false);
    }
  }, [api]);

  if (state === "checking" || state === "hidden") return null;

  const box = `rounded-2xl bg-card p-3.5 shadow-[inset_0_0_0_1px_rgb(var(--c-line))] ${className}`;

  if (state === "needs-install") {
    return (
      <div className={box}>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-[1.45] text-muted">
          On iPhone, alerts only work once CloseBuy is on your Home Screen. Tap the Share button in Safari, choose{" "}
          <span className="font-semibold text-ink">Add to Home Screen</span>, then open it from there and come back to this page.
        </p>
      </div>
    );
  }

  if (state === "unsupported") {
    return (
      <div className={box}>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-[1.45] text-muted">This browser can&apos;t show alerts. Try Chrome or Safari, or keep this page open.</p>
      </div>
    );
  }

  if (state === "blocked") {
    return (
      <div className={box}>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-[1.45] text-muted">
          Alerts are blocked for this site. Allow notifications in your browser&apos;s site settings, then reload.
        </p>
      </div>
    );
  }

  const on = state === "on";
  return (
    <div className={box}>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-[13px] leading-[1.45] text-muted">{on ? "On. You'll be notified on this device." : description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={title}
          disabled={busy}
          onClick={on ? turnOff : turnOn}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-50 ${on ? "bg-accent" : "bg-line"}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-150 ${on ? "translate-x-5" : ""}`}
          />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
