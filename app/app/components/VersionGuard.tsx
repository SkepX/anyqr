"use client";
import { useEffect } from "react";

/** Reload the tab when a new deployment is live — but never while a
 *  wallet flow is running (client-sdk sets window.__qrpayBusy inside
 *  the tx lock). Kills the stale-tab class: every fix used to require
 *  the user to remember a hard refresh on both tabs. */
export function VersionGuard() {
  useEffect(() => {
    let current: string | null = null;
    const tick = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { v } = (await r.json()) as { v: string };
        if (current === null) {
          current = v;
          return;
        }
        const busy = (window as unknown as { __qrpayBusy?: number }).__qrpayBusy;
        if (v !== current && !busy) {
          console.log("[version] new deployment detected — reloading");
          window.location.reload();
        }
      } catch {}
    };
    void tick();
    const iv = setInterval(tick, 20_000);
    return () => clearInterval(iv);
  }, []);
  return null;
}
