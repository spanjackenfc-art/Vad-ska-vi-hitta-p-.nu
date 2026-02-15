"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type Props = {
  onlyHome?: boolean;
  delayMs?: number;
  storageKey?: string;
};

function isValidEmail(x: string) {
  const s = String(x || "").trim();
  if (!s) return false;
  // enkel, praktisk validering (inte RFC-komplett)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function NewsletterPopup({
  onlyHome = true,
  delayMs = 3500,
  storageKey = "newsletter_popup_dismissed_v3",
}: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const eligible = useMemo(() => {
    if (onlyHome && pathname !== "/") return false;
    return true;
  }, [onlyHome, pathname]);

  useEffect(() => {
    if (!eligible) return;

    try {
      const dismissed = window.localStorage.getItem(storageKey);
      if (dismissed === "1") return;
    } catch {}

    const t = window.setTimeout(() => setOpen(true), delayMs);
    return () => window.clearTimeout(t);
  }, [eligible, delayMs, storageKey]);

  function close() {
    setOpen(false);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {}
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const em = String(email || "").trim();
    if (!isValidEmail(em)) {
      setStatus("error");
      setErrorMsg("Skriv en giltig e-postadress.");
      return;
    }

    setStatus("submitting");

    // Försök API först (vi lägger till /api/newsletter i nästa steg)
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: em, pathname }),
      });

      if (res.ok) {
        setStatus("success");
        // auto-close efter kort delay + markera dismissed
        window.setTimeout(() => close(), 900);
        return;
      }

      // Om API saknas / failar — fallback mailto så du tappar inte leaden helt
      const mailto = `mailto:hello@vadskavihittapa.nu?subject=Nyhetsbrev&body=Hej!%0A%0AJag%20vill%20prenumerera%20p%C3%A5%20nyhetsbrevet.%0A%0AMin%20mejl%3A%20${encodeURIComponent(
        em
      )}%0A%0ASida%3A%20${encodeURIComponent(pathname || "/")}%0A`;
      window.location.href = mailto;

      setStatus("success");
      window.setTimeout(() => close(), 900);
      return;
    } catch {
      setStatus("error");
      setErrorMsg("Kunde inte skicka just nu. Försök igen om en stund.");
      return;
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] pointer-events-none">
      {/* overlay */}
      <button
        aria-label="Stäng"
        onClick={close}
        className="absolute inset-0 bg-black/20 pointer-events-auto"
      />

      {/* right slide-in panel */}
      <div className="absolute right-3 bottom-3 sm:right-6 sm:bottom-6 pointer-events-auto">
        <div className="w-[calc(100vw-24px)] max-w-md rounded-3xl shadow-2xl overflow-hidden ring-1 ring-black/5 bg-white">
          <div className="relative p-5 sm:p-6">
            {/* colorful backdrop */}
            <div className="absolute inset-0 bg-gradient-to-br from-pink-200 via-pink-100 to-amber-50" />

            {/* content */}
            <div className="relative">
              <button
                onClick={close}
                className="absolute -top-1 -right-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/70 backdrop-blur text-slate-800 hover:bg-white"
                aria-label="Stäng"
                title="Stäng"
              >
                ✕
              </button>

              <div className="grid grid-cols-[1fr_128px] gap-4 items-center">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-700/70">
                    Nyhetsbrev
                  </div>

                  <div className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 leading-[1.05]">
                    Vill du få koll på allt kul som händer i helgen?
                  </div>

                  <div className="mt-2 text-sm text-slate-700/80">
                    Inga spam. Avsluta när du vill.
                  </div>
                </div>

                {/* simple inline “bird” illustration (no external assets) */}
                <div className="justify-self-end">
                  <svg
                    viewBox="0 0 180 180"
                    className="h-28 w-28 drop-shadow-sm"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id="b" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0" stopColor="#0ea5e9" />
                        <stop offset="1" stopColor="#2563eb" />
                      </linearGradient>
                    </defs>
                    <circle cx="96" cy="92" r="62" fill="url(#b)" />
                    <circle cx="118" cy="78" r="16" fill="#fff" opacity="0.95" />
                    <circle cx="122" cy="78" r="8" fill="#0b1220" />
                    <path
                      d="M62 92c18 6 28 16 40 34-26 2-44-6-54-20 2-8 6-12 14-14z"
                      fill="#1d4ed8"
                      opacity="0.45"
                    />
                    <path
                      d="M148 96l-38 10 18 18z"
                      fill="#f59e0b"
                      opacity="0.95"
                    />
                    <rect x="46" y="112" width="56" height="34" rx="10" fill="#fb7185" opacity="0.95" />
                    <path d="M55 125h38" stroke="#fde68a" strokeWidth="4" strokeLinecap="round" />
                    <path d="M55 135h28" stroke="#fde68a" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                </div>
              </div>

              <form onSubmit={onSubmit} className="mt-5 grid gap-3">
                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-slate-800/80">
                    Din e-post
                  </label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    inputMode="email"
                    autoComplete="email"
                    placeholder="name@email.com"
                    className="h-12 w-full rounded-2xl bg-white/80 backdrop-blur px-4 text-sm text-slate-900 ring-1 ring-black/10 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                  />
                </div>

                {status === "error" && errorMsg ? (
                  <div className="text-sm text-rose-700">{errorMsg}</div>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="submit"
                    disabled={status === "submitting"}
                    className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
                  >
                    {status === "submitting" ? "Skickar..." : status === "success" ? "Klart!" : "Prenumerera"}
                  </button>

                  <button
                    type="button"
                    onClick={close}
                    className="inline-flex h-12 items-center justify-center rounded-2xl bg-white/70 backdrop-blur px-5 text-sm font-semibold text-slate-800 ring-1 ring-black/10 hover:bg-white"
                  >
                    Inte nu
                  </button>
                </div>

                <div className="text-[11px] text-slate-700/70">
                  Genom att prenumerera godkänner du att vi skickar mail med tips på events.
                </div>
              </form>
            </div>
          </div>

          {/* slide-in animation */}
          <style jsx>{`
            div {
              animation: slideIn 280ms ease-out;
            }
            @keyframes slideIn {
              from {
                transform: translateX(18px);
                opacity: 0;
              }
              to {
                transform: translateX(0);
                opacity: 1;
              }
            }
          `}</style>
        </div>
      </div>
    </div>
  );
}
