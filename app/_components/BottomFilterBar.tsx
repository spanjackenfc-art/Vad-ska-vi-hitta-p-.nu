"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Category = "" | "familj" | "teater" | "musik" | "standup" | "ovrigt";

type MonthOption = { value: string; label: string };

type Props = {
  cities: string[];
  monthOptions: MonthOption[];
};

function setParam(sp: URLSearchParams, key: string, value: string | null) {
  const next = new URLSearchParams(sp.toString());
  if (!value || value.trim() === "") next.delete(key);
  else next.set(key, value);
  next.delete("page");
  return next;
}

export default function BottomFilterBar({ cities, monthOptions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const category = (((sp.get("category") as Category | null) ?? "") as string).toLowerCase() as Category;
  const city = sp.get("city") ?? "";
  const month = sp.get("month") ?? "";

  const onChange = (key: "category" | "city" | "month", value: string) => {
    // "__ALL__" används bara för city (Hela Sverige)
    const v = (key === "city" && value === "__ALL__") ? "" : value;
    const next = setParam(sp as any, key, v);
    router.push(`${pathname}?${next.toString()}`);
  };

  // Default month i UI:
  // - om URL har month, använd den
  // - annars visa första "riktiga" månaden (index 1) eftersom index 0 är "all"
  const defaultMonthValue = monthOptions[1]?.value || monthOptions[0]?.value || "";
  const monthValue = month || defaultMonthValue;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/70 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2">
        {/* Category pills */}
        <div className="flex flex-1 items-center gap-2 overflow-x-auto">
          {(
            [
              { v: "", label: "Alla" },
              { v: "familj", label: "Familj" },
              { v: "teater", label: "Teater" },
              { v: "musik", label: "Musik" },
  { v: "dans", label: "Dans" },
              { v: "standup", label: "Standup" },
              { v: "ovrigt", label: "Övrigt" },
            ] as const
          ).map((c) => {
            const active = category === c.v;
            return (
              <button
                key={c.v}
                type="button"
                onClick={() => onChange("category", c.v)}
                className={[
                  "shrink-0 rounded-full px-3 py-2 text-sm font-semibold transition",
                  active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-800 hover:bg-slate-200",
                ].join(" ")}
                aria-pressed={active}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Month + City (desktop) */}
        <div className="hidden sm:flex items-center gap-2">
          <select
            value={monthValue}
            onChange={(e) => onChange("month", e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm"
            aria-label="Välj månad"
          >
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            value={city || "__ALL__"}
            onChange={(e) => onChange("city", e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm"
            aria-label="Välj stad"
          >
            <option value="__ALL__">Hela Sverige</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Month + City (mobile compact) */}
        <div className="flex sm:hidden items-center gap-2">
          <select
            value={monthValue}
            onChange={(e) => onChange("month", e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm font-medium text-slate-900 shadow-sm"
            aria-label="Månad"
          >
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === "all" ? "Alla" : o.value}
              </option>
            ))}
          </select>

          <select
            value={city || "__ALL__"}
            onChange={(e) => onChange("city", e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm font-medium text-slate-900 shadow-sm"
            aria-label="Stad"
          >
            <option value="__ALL__">Sverige</option>
            {cities.slice(0, 60).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
