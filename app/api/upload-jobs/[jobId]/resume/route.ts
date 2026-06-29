import { NextResponse } from "next/server";

import { getClientSafeError } from "@/app/api/audiences/meta";
import { resumeAudienceUploadJob } from "@/lib/audience-upload/jobs";
import {
  enqueueAudienceUploadJob,
  removeAudienceUploadJob,
} from "@/lib/audience-upload/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Resume a failed/cancelled job: create a new job continuing from the confirmed
// uploaded offset, enqueue it, and drop the old job from the BullMQ queue.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    const job = await resumeAudienceUploadJob(jobId);
    await enqueueAudienceUploadJob(job.id);
    // Best-effort: clear the old job from BullMQ (its Redis hash is already gone).
    await removeAudienceUploadJob(jobId).catch(() => {});

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể resume upload job."
    );

    return NextResponse.json(
      { error: safeError.message, details: safeError.details },
      { status: safeError.status }
    );
  }
}
