import { NextResponse } from "next/server";

import {
  addUsersToAudience,
  deleteAudience,
  getClientSafeError,
} from "../meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = (await request.json()) as {
      hashedEmails?: unknown;
    };
    const { id } = await params;

    const result = await addUsersToAudience({
      audienceId: id,
      hashedEmails: body.hashedEmails,
    });

    return NextResponse.json(result);
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể thêm dữ liệu vào audience hiện tại."
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await deleteAudience(id);

    return NextResponse.json(result);
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể xóa audience trên Meta."
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
