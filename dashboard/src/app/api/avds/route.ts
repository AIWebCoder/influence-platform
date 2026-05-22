import { NextResponse } from "next/server";

const controllerBase =
  process.env.EMULATOR_CONTROLLER_URL ||
  process.env.NEXT_PUBLIC_EMULATOR_CONTROLLER_URL ||
  "http://emulator-controller:9102";

export async function GET() {
  try {
    const res = await fetch(`${controllerBase}/avds`, { cache: "no-store" });
    const raw = await res.text();
    let data: Record<string, unknown>;
    try {
      data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      data = { count: 0, items: [], error: raw || `Upstream HTTP ${res.status}` };
    }
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        count: 0,
        items: [],
        error: error instanceof Error ? error.message : "Failed to fetch AVD list",
      },
      { status: 502 }
    );
  }
}
