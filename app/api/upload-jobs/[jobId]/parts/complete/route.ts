import { NextResponse } from "next/server";

import { getClientSafeError } from "@/app/api/audiences/meta";
import { recordAudienceUploadPart } from "@/lib/audience-upload/jobs";
import { buildShardObjectKey } from "@/lib/audience-upload/storage";

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
      hashCount?: unknown;
      objectKey?: unknown;
    };
    const partIndex =
      typeof body.partIndex === "number"
        ? body.partIndex
        : Number.parseInt(String(body.partIndex ?? ""), 10);
    const hashCount =
      typeof body.hashCount === "number"
        ? body.hashCount
        : Number.parseInt(String(body.hashCount ?? ""), 10);
    const objectKey =
      typeof body.objectKey === "string" ? body.objectKey.trim() : "";

    if (objectKey !== buildShardObjectKey(jobId, partIndex)) {
      return NextResponse.json(
        {
          error: "Object key upload không khớp với shard được cấp.",
        },
        {
          status: 400,
        }
      );
    }

    const job = await recordAudienceUploadPart({
      jobId,
      partIndex,
      hashCount,
      objectKey,
    });

    return NextResponse.json({ job });
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể ack shard upload vào Redis."
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