import { NextResponse } from "next/server";

import { getClientSafeError } from "@/app/api/audiences/meta";
import { createAudienceUploadJob, listRecentAudienceUploadJobs } from "@/lib/audience-upload/jobs";
import { enqueueAudienceUploadJob } from "@/lib/audience-upload/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const jobs = await listRecentAudienceUploadJobs();

    return NextResponse.json(
      { jobs },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể tải danh sách upload jobs."
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
      kind?: unknown;
      name?: unknown;
      description?: unknown;
      nasFilePath?: unknown;
      audienceId?: unknown;
      adAccountId?: unknown;
      adAccountName?: unknown;
      appName?: unknown;
      tokenId?: unknown;
      startOffsetMb?: unknown;
      fileSize?: unknown;
    };

    // User-entered start offset in MB → bytes (resume a new job from there).
    const startOffsetBytes =
      typeof body.startOffsetMb === "number" && body.startOffsetMb > 0
        ? Math.floor(body.startOffsetMb * 1024 * 1024)
        : undefined;

    const job = await createAudienceUploadJob({
      kind: body.kind === "append" ? "append" : "create",
      name: typeof body.name === "string" ? body.name : undefined,
      description:
        typeof body.description === "string" ? body.description : undefined,
      nasFilePath:
        typeof body.nasFilePath === "string" ? body.nasFilePath : "",
      audienceId:
        typeof body.audienceId === "string" ? body.audienceId : undefined,
      adAccountId:
        typeof body.adAccountId === "string" ? body.adAccountId : undefined,
      adAccountName:
        typeof body.adAccountName === "string" ? body.adAccountName : undefined,
      appName: typeof body.appName === "string" ? body.appName : undefined,
      tokenId: typeof body.tokenId === "string" ? body.tokenId : undefined,
      startOffsetBytes,
      fileSize:
        typeof body.fileSize === "number" ? body.fileSize : undefined,
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