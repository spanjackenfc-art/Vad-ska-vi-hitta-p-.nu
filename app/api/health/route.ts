import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function runDbCheck() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceRole) {
    throw new Error("Missing Supabase server env");
  }

  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("sources")
    .select("name")
    .eq("is_active", true)
    .limit(1);

  if (error) throw error;

  return {
    ok: true,
    checked_table: "sources",
    active_source_found: Array.isArray(data) && data.length > 0,
  };
}

export async function GET() {
  try {
    getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = await runDbCheck();

    return NextResponse.json(
      {
        ok: true,
        service: "health",
        db,
        ts: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        service: "health",
        error: String(error?.message || error || "unknown_error"),
        ts: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function HEAD() {
  try {
    getEnv("SUPABASE_SERVICE_ROLE_KEY");
    await runDbCheck();
    return new Response(null, { status: 200 });
  } catch {
    return new Response(null, { status: 500 });
  }
}
