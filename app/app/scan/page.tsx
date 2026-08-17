"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { parseUpiQr } from "../lib/qr";

function ScanInner() {
  const router = useRouter();
  const params = useSearchParams();
  const ccy = params.get("ccy") ?? "INR";
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [starting, setStarting] = useState(true);

  const handleText = useCallback(
    (text: string) => {
      const parsed = parseUpiQr(text);
      if (!parsed) {
        setError("Not a UPI QR. Try again.");
        return;
      }
      const qs = new URLSearchParams({
        pa: parsed.paymentAddress,
        ...(parsed.payeeName ? { pn: parsed.payeeName } : {}),
        ...(parsed.amount ? { am: String(parsed.amount) } : {}),
        ccy,
      });
      router.push(`/pay?${qs.toString()}`);
    },
    [ccy, router],
  );

  useEffect(() => {
    let cancelled = false;
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    let running = false;

    const stopSafely = async () => {
      if (!scanner || !running) return;
      running = false;
      try {
        await scanner.stop();
      } catch {
        /* already stopped */
      }
      try {
        scanner.clear();
      } catch {
        /* noop */
      }
    };

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled || !containerRef.current) return;
        scanner = new Html5Qrcode("qr-reader");
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 260 } },
          (text) => {
            if (cancelled) return;
            cancelled = true;
            void stopSafely().then(() => handleText(text));
          },
          () => {
            /* ignore per-frame miss */
          },
        );
        running = true;
        setStarting(false);
      } catch {
        setError("Camera blocked or unavailable. Paste QR text instead.");
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      void stopSafely();
    };
  }, [handleText]);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manual.trim()) return;
    handleText(manual);
  };

  return (
    <main className="flex-1 flex flex-col items-center px-5 py-6">
      <div className="max-w-md w-full">
        <button
          onClick={() => router.back()}
          className="text-sm text-[color:var(--text-muted)] mb-4 hover:text-[color:var(--text)]"
        >
          ← Back
        </button>
        <h1 className="display text-4xl leading-tight mb-2">Scan a QR</h1>
        <p className="text-[color:var(--text-muted)] text-sm mb-6">
          Point at any UPI, PIX, or QRIS QR code.
        </p>

        <div className="relative aspect-square w-full rounded-2xl overflow-hidden border border-[color:var(--border)] bg-black mb-4">
          <div id="qr-reader" ref={containerRef} className="w-full h-full" />
          {starting && (
            <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
              Starting camera…
            </div>
          )}
          {/* Corner brackets overlay */}
          <div className="pointer-events-none absolute inset-6">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-[color:var(--accent)] rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-[color:var(--accent)] rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-[color:var(--accent)] rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-[color:var(--accent)] rounded-br-lg" />
          </div>
        </div>

        {error && (
          <div className="text-sm text-[color:var(--warning)] mb-4">{error}</div>
        )}

        <form onSubmit={submitManual} className="card-flat">
          <label className="block text-xs text-[color:var(--text-muted)] mb-2">
            Or paste a UPI URI
          </label>
          <div className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="upi://pay?pa=merchant@upi&am=25"
              className="flex-1 px-3 py-2 rounded-lg border border-[color:var(--border-soft)] bg-white text-sm font-mono focus:border-[color:var(--accent)] outline-none"
            />
            <button type="submit" className="btn btn-primary">
              Go
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Loading…</div>}>
      <ScanInner />
    </Suspense>
  );
}
