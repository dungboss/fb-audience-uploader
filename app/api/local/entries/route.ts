import { NextResponse } from "next/server";

import { LocalFileError, listLocalFiles } from "@/lib/local-files.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Flat listing of the files inside LOCAL_FILE_ROOT. Returns
 * `{ configured: false }` when the env var is unset so the UI can hide the
 * local-file feature entirely instead of showing a broken picker.
 */
export async function GET() {
  try {
    const listing = await listLocalFiles();
    return NextResponse.json(listing, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof LocalFileError || error instanceof Error
        ? error.message
        : "Không thể đọc thư mục local.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
