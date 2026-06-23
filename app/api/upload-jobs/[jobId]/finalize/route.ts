import { NextResponse } from "next/server";

import { getClientSafeError } from "@/app/api/audiences/meta";
import { finalizeAudienceUploadJob } from "@/lib/audience-upload/jobs";
import { enqueueAudienceUploadJob } from "@/lib/audience-upload/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const body = (await request.json()) as {
      totalParts?: unknown;
      totalHashes?: unknown;
      duplicateCount?: unknown;
    };

    const job = await finalizeAudienceUploadJob({
      jobId,
      totalParts:
        typeof body.totalParts === "number"
          ? body.totalParts
          : Number.parseInt(String(body.totalParts ?? ""), 10),
      totalHashes:
        typeof body.totalHashes === "number"
          ? body.totalHashes
          : Number.parseInt(String(body.totalHashes ?? ""), 10),
      duplicateCount:
        typeof body.duplicateCount === "number"
          ? body.duplicateCount
          : Number.parseInt(String(body.duplicateCount ?? ""), 10),
    });

    await enqueueAudienceUploadJob(job.id);

    return NextResponse.json({ job });
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể finalize upload job."
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
