import { NextResponse } from "next/server";

const controllerBase =
  process.env.EMULATOR_CONTROLLER_URL ||
  process.env.NEXT_PUBLIC_EMULATOR_CONTROLLER_URL ||
  "http://emulator-controller:9102";

export async function GET() {
  try {
    const traceId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const res = await fetch(`${controllerBase}/emulators`, {
      cache: "no-store",
      headers: { "x-trace-id": String(traceId) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Emulator controller returned ${res.status}: ${text}`);
    }
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch emulators" },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { serial?: string };
    const serial = String(body?.serial || "").trim();
    if (!serial) {
      return NextResponse.json(
        { success: false, phase: "validation_failed", message: "serial is required" },
        { status: 400 }
      );
    }
    const res = await fetch(
      `${controllerBase}/emulators/${encodeURIComponent(serial)}/actions/restart`,
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
        phase: "proxy_error",
        message: error instanceof Error ? error.message : "Restart proxy failed",
      },
      { status: 502 }
    );
  }
}
