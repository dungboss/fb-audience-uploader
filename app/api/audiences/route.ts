import { NextResponse } from "next/server";

import { createAudience, getClientSafeError, listAudiences } from "./meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const audiences = await listAudiences();
    return NextResponse.json({ audiences });
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể tải danh sách Custom Audiences từ Meta."
    );

    return NextResponse.json(
      {
        error: safeError.message,
        details: safeError.details,
      },
      {
        status: safeError.status,
      }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: unknown;
      description?: unknown;
      hashedEmails?: unknown;
    };

    const result = await createAudience({
      name: typeof body.name === "string" ? body.name : "",
      description:
        typeof body.description === "string" ? body.description : undefined,
      hashedEmails: body.hashedEmails,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể tạo audience mới trên Meta."
    );

    return NextResponse.json(
      {
        error: safeError.message,
        details: safeError.details,
      },
      {
        status: safeError.status,
      }
    );
  }
}
