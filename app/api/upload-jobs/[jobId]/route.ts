import { NextResponse } from "next/server";

import { getClientSafeError } from "@/app/api/audiences/meta";
import { getAudienceUploadJob } from "@/lib/audience-upload/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const job = await getAudienceUploadJob(jobId);

    return NextResponse.json({ job });
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể tải trạng thái upload job."
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
