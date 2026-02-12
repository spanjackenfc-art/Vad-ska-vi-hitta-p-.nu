export default function DescriptionToggle({ text }: { text?: string | null }) {
  const t = (text ?? "").trim();
  if (!t) return null;

  const short = t.length > 220 ? t.slice(0, 220).trimEnd() + "…" : t;
  const needsToggle = t.length > 220;

  return (
    <div className="mt-2 text-sm text-slate-600">
      {needsToggle ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-xs font-semibold text-slate-900 underline underline-offset-4">
            <span className="group-open:hidden">Visa mer</span>
            <span className="hidden group-open:inline">Visa mindre</span>
          </summary>
          <p className="mt-2 whitespace-pre-line">{t}</p>
        </details>
      ) : (
        <p className="whitespace-pre-line">{short}</p>
      )}
    </div>
  );
}
