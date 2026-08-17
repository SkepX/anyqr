"use client";
import Link from "next/link";
import { useState } from "react";
import { COUNTRIES } from "../lib/countries";

export default function StartPage() {
  const [picked, setPicked] = useState<string>("INR");
  const country = COUNTRIES.find((c) => c.code === picked)!;

  return (
    <main className="flex-1 flex flex-col items-center px-5 py-10">
      <div className="max-w-md w-full">
        <div className="eyebrow mb-3">Step 1 / 3</div>
        <h1 className="display text-3xl leading-tight mb-2">
          Where do we pay out?
        </h1>
        <p className="text-[color:var(--text-muted)] mb-8 text-sm">
          Pick the country your merchant collects local cash in.
        </p>

        <ul className="flex flex-col gap-1.5 mb-8">
          {COUNTRIES.map((c) => {
            const selected = c.code === picked;
            return (
              <li key={c.code}>
                <button
                  onClick={() => c.live && setPicked(c.code)}
                  disabled={!c.live}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded border transition-colors duration-100 ${
                    selected
                      ? "bg-[color:var(--accent)] border-[color:var(--border)] text-[color:var(--accent-ink)]"
                      : c.live
                        ? "bg-[color:var(--surface)] border-[color:var(--border-soft)] hover:border-[color:var(--border)]"
                        : "bg-transparent border-[color:var(--border-soft)] text-[color:var(--text-faint)] cursor-not-allowed"
                  }`}
                >
                  <span className="text-xl leading-none w-6 text-center">
                    {c.flag}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-sm">{c.name}</span>
                    <span
                      className={`block text-xs mt-0.5 ${
                        selected ? "opacity-70" : "text-[color:var(--text-muted)]"
                      }`}
                    >
                      {c.symbol} · {c.code}
                      {!c.live && " · soon"}
                    </span>
                  </span>
                  <span
                    className={`w-4 h-4 border flex items-center justify-center ${
                      selected
                        ? "bg-[color:var(--accent-ink)] border-[color:var(--accent-ink)]"
                        : c.live
                          ? "border-[color:var(--border)]"
                          : "border-[color:var(--border-soft)]"
                    }`}
                  >
                    {selected && (
                      <svg
                        viewBox="0 0 12 12"
                        className="w-3 h-3"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M2 6.5l2.5 2.5L10 3" />
                      </svg>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <Link
          href={`/home?ccy=${country.code}`}
          className="btn btn-primary w-full text-base py-4"
        >
          Continue →
        </Link>
      </div>
    </main>
  );
}
