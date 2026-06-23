import { NextResponse } from "next/server";

import { getClientSafeError } from "@/app/api/audiences/meta";
import { getAudienceUploadJob } from "@/lib/audience-upload/jobs";
import { createShardUploadUrl } from "@/lib/audience-upload/s3";

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
      partIndex?: unknown;
    };
    const partIndex =
      typeof body.partIndex === "number"
        ? body.partIndex
        : Number.parseInt(String(body.partIndex ?? ""), 10);

    const job = await getAudienceUploadJob(jobId);

    if (job.finalizedAt) {
      return NextResponse.json(
        {
          error: "Upload job đã finalize nên không nhận thêm shard mới.",
        },
        {
          status: 409,
        }
      );
    }

    const presignedPart = await createShardUploadUrl(jobId, partIndex);

    return NextResponse.json({
      job,
      ...presignedPart,
    });
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể tạo presigned URL cho shard upload."
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
