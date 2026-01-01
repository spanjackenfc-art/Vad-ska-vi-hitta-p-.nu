import { supabase } from "../lib/supabaseClient";

export default async function Home() {
  const { data, error } = await supabase
    .from("events")
    .select("title,start_at,city,venue_name,price_type,ticket_url")
    .eq("status", "active")
    .order("start_at", { ascending: true })
    .limit(50);

  if (error) {
    return <pre>{JSON.stringify(error, null, 2)}</pre>;
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Sverige Events (MVP)</h1>
      <p>Kommande evenemang</p>

      <ul>
        {(data ?? []).map((e, idx) => (
          <li key={idx} style={{ marginBottom: 16 }}>
            <strong>{e.title}</strong>
            <div>{new Date(e.start_at).toLocaleString("sv-SE")}</div>
            <div>{e.city ?? "—"} · {e.venue_name ?? "—"}</div>
            <div>{e.price_type ?? "unknown"}</div>
            {e.ticket_url ? (
              <a href={e.ticket_url} target="_blank" rel="noreferrer">
                Biljetter
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
