import { NextResponse } from "next/server";

const controllerBase =
  process.env.EMULATOR_CONTROLLER_URL ||
  process.env.NEXT_PUBLIC_EMULATOR_CONTROLLER_URL ||
  "http://emulator-controller:9102";

type AddEmulatorBody = {
  mode?: "launch_avd" | "adb_connect";
  avd_name?: string;
  host_port?: string;
  headless?: boolean;
};

export async function POST(request: Request) {
  let body: AddEmulatorBody;
  try {
    body = (await request.json()) as AddEmulatorBody;
  } catch {
    return NextResponse.json(
      { success: false, phase: "validation_failed", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const mode = body?.mode;
  if (mode !== "launch_avd" && mode !== "adb_connect") {
    return NextResponse.json(
      {
        success: false,
        phase: "validation_failed",
        message: "mode must be 'launch_avd' or 'adb_connect'",
      },
      { status: 400 }
    );
  }

  if (mode === "launch_avd" && !String(body?.avd_name || "").trim()) {
    return NextResponse.json(
      { success: false, phase: "validation_failed", message: "avd_name is required" },
      { status: 400 }
    );
  }

  if (mode === "adb_connect" && !String(body?.host_port || "").trim()) {
    return NextResponse.json(
      { success: false, phase: "validation_failed", message: "host_port is required" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`${controllerBase}/emulators/actions/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const raw = await res.text();
    let data: Record<string, unknown>;
    try {
      data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      data = {
        success: res.ok,
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
        message: error instanceof Error ? error.message : "Add emulator proxy failed",
      },
      { status: 502 }
    );
  }
}
