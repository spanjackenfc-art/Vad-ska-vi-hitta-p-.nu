import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isValidEmail(x: string) {
  const s = String(x || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim();
    const pathname = body?.pathname ? String(body.pathname).slice(0, 200) : null;

    if (!isValidEmail(email)) {
      return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
    }

    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json({ ok: false, error: "missing_env" }, { status: 500 });
    }

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    // upsert på lower(email) via unique index
    const { error } = await supabase
      .from("newsletter_signups")
      .upsert(
        { email, pathname, source: "popup" },
        { onConflict: "email" }
      );

    if (error) {
      return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
