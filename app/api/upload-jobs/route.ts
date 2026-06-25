import { NextResponse } from "next/server";

import { getClientSafeError } from "@/app/api/audiences/meta";
import { createAudienceUploadJob } from "@/lib/audience-upload/jobs";
import { enqueueAudienceUploadJob } from "@/lib/audience-upload/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      kind?: unknown;
      name?: unknown;
      description?: unknown;
      nasFilePath?: unknown;
      audienceId?: unknown;
    };

    const job = await createAudienceUploadJob({
      kind: body.kind === "append" ? "append" : "create",
      name: typeof body.name === "string" ? body.name : undefined,
      description:
        typeof body.description === "string" ? body.description : undefined,
      nasFilePath:
        typeof body.nasFilePath === "string" ? body.nasFilePath : "",
      audienceId:
        typeof body.audienceId === "string" ? body.audienceId : undefined,
    });

    await enqueueAudienceUploadJob(job.id);

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể khởi tạo upload job."
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