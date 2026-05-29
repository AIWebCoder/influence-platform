import { NextResponse } from "next/server";

const controllerBase =
  process.env.EMULATOR_CONTROLLER_URL ||
  process.env.NEXT_PUBLIC_EMULATOR_CONTROLLER_URL ||
  "http://emulator-controller:9102";

export async function POST(
  _request: Request,
  context: { params: { serial: string } }
) {
  const serial = context.params.serial;
  try {
    const res = await fetch(
      `${controllerBase}/emulators/${encodeURIComponent(serial)}/actions/stop`,
      {
        method: "POST",
        cache: "no-store",
      }
    );
    const raw = await res.text();
    let data: Record<string, unknown>;
    try {
      data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      data = {
        success: res.ok,
        serial,
        phase: res.ok ? "completed" : "proxy_error",
        message: raw || `Upstream returned HTTP ${res.status}`,
      };
    }
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        serial,
        phase: "proxy_error",
        message: error instanceof Error ? error.message : "Stop proxy failed",
      },
      { status: 502 }
    );
  }
}
