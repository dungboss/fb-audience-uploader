import { NextResponse } from "next/server";

import { createAudience, getClientSafeError } from "@/app/api/audiences/meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      audienceName?: unknown;
      description?: unknown;
      hashedEmails?: unknown;
      adAccountId?: unknown;
    };

    const result = await createAudience({
      name:
        typeof body.audienceName === "string" ? body.audienceName : "Untitled audience",
      description:
        typeof body.description === "string" ? body.description : undefined,
      hashedEmails: body.hashedEmails,
      adAccountId:
        typeof body.adAccountId === "string" ? body.adAccountId : undefined,
    });

    return NextResponse.json({
      success: true,
      audienceId: result.audienceId,
      numReceived: result.uploadedCount,
      invalidEntryCount: result.invalidEntryCount,
      sessionId: result.sessionId,
    });
  } catch (error) {
    const safeError = getClientSafeError(error, "Không thể tạo audience qua route tương thích cũ.");

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
