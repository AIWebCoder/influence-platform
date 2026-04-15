import { NextResponse } from "next/server";

const controllerBase =
  process.env.EMULATOR_CONTROLLER_URL ||
  process.env.NEXT_PUBLIC_EMULATOR_CONTROLLER_URL ||
  "http://emulator-controller:9102";

export async function GET() {
  try {
    const res = await fetch(`${controllerBase}/emulators`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Emulator controller returned ${res.status}: ${text}`);
    }
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        count: 0,
        items: [],
        error: error instanceof Error ? error.message : "Failed to fetch emulators",
      },
      { status: 200 }
    );
  }
}
