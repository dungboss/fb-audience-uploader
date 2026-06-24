import { NextResponse } from "next/server";

import { normalizeWebDavPath } from "@/lib/webdav";
import { fetchWebDavDirectoryResponse } from "@/lib/webdav.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedPath = normalizeWebDavPath(url.searchParams.get("path") ?? "/");

  try {
    const directory = await fetchWebDavDirectoryResponse(requestedPath);
    return NextResponse.json(directory);
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Không thể đọc thư mục NAS.";

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}
