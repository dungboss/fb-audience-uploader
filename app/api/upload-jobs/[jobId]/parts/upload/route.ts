import { NextResponse } from "next/server";

import { getClientSafeError } from "@/app/api/audiences/meta";
import { buildShardObjectKey, writeShardHashes } from "@/lib/audience-upload/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const url = new URL(request.url);
    const partIndex = Number.parseInt(url.searchParams.get("partIndex") ?? "", 10);

    if (!Number.isFinite(partIndex) || partIndex < 0) {
      return NextResponse.json(
        {
          error: "Part index không hợp lệ.",
        },
        {
          status: 400,
        }
      );
    }

    const objectKey = buildShardObjectKey(jobId, partIndex);
    const body = await request.text();

    if (!body) {
      return NextResponse.json(
        {
          error: "Nội dung shard trống.",
        },
        {
          status: 400,
        }
      );
    }

    await writeShardHashes(objectKey, body);

    return NextResponse.json({ objectKey });
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể ghi shard lên NAS temp."
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