import { NextResponse } from "next/server";

import { getClientSafeError } from "@/app/api/audiences/meta";
import {
  cancelAudienceUploadJob,
  deleteAudienceUploadJob,
  getAudienceUploadJob,
} from "@/lib/audience-upload/jobs";
import { removeAudienceUploadJob } from "@/lib/audience-upload/queue";

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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const existing = await getAudienceUploadJob(jobId);

    // Active job → cancel (worker stops cooperatively, queue entry removed).
    if (existing.status === "queued" || existing.status === "processing") {
      const job = await cancelAudienceUploadJob(jobId);
      await removeAudienceUploadJob(jobId);
      return NextResponse.json({ job });
    }

    // Terminal job (failed/completed/cancelled) → remove it from the list.
    await removeAudienceUploadJob(jobId).catch(() => {});
    const result = await deleteAudienceUploadJob(jobId);
    return NextResponse.json(result);
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể huỷ hoặc xoá upload job."
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