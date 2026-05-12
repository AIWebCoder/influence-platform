import { NextResponse } from "next/server";

const controllerBase =
  process.env.EMULATOR_CONTROLLER_URL ||
  process.env.NEXT_PUBLIC_EMULATOR_CONTROLLER_URL ||
  "http://emulator-controller:9102";

export async function GET(
  _request: Request,
  context: { params: { serial: string } }
) {
  const serial = context.params.serial;
  try {
    const res = await fetch(
      `${controllerBase}/emulators/${encodeURIComponent(serial)}/frame.png`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch frame for ${serial}` },
        { status: res.status }
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Frame proxy failed" },
      { status: 500 }
    );
  }
}
