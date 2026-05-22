import { NextResponse } from "next/server";

const controllerBase =
  process.env.EMULATOR_CONTROLLER_URL ||
  process.env.NEXT_PUBLIC_EMULATOR_CONTROLLER_URL ||
  "http://emulator-controller:9102";

export async function POST(
  request: Request,
  context: { params: { serial: string } }
) {
  const serial = context.params.serial;
  try {
    const body = await request.json();
    const res = await fetch(
      `${controllerBase}/emulators/${encodeURIComponent(serial)}/input/key`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );
    const raw = await res.text();
    let data: Record<string, unknown>;
    try {
      data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      data = {
        status: res.ok ? "success" : "error",
        execution_time_ms: 0,
        error: raw || `Upstream returned HTTP ${res.status}`,
      };
    }
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        execution_time_ms: 0,
        error: error instanceof Error ? error.message : "Key proxy failed",
      },
      { status: 500 }
    );
  }
}
