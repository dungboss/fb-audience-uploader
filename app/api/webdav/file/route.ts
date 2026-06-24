import { NextResponse } from "next/server";

import { normalizeWebDavPath } from "@/lib/webdav";
import { buildWebDavUrl, getWebDavAuthHeaders } from "@/lib/webdav.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedPath = url.searchParams.get("path") ?? "";

  if (!requestedPath.trim()) {
    return NextResponse.json(
      {
        error: "Thiếu đường dẫn file NAS.",
      },
      {
        status: 400,
      }
    );
  }

  try {
    const normalizedPath = normalizeWebDavPath(requestedPath);
    const webDavResponse = await fetch(buildWebDavUrl(normalizedPath, false), {
      method: "GET",
      headers: {
        ...getWebDavAuthHeaders(),
        Accept: "*/*",
      },
    });

    if (!webDavResponse.ok) {
      throw new Error(`WebDAV file download failed (${webDavResponse.status})`);
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      webDavResponse.headers.get("content-type")?.split(";")[0]?.trim() ||
        "application/octet-stream"
    );
    headers.set(
      "Cache-Control",
      webDavResponse.headers.get("cache-control") || "no-store"
    );

    const contentLength = webDavResponse.headers.get("content-length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    if (webDavResponse.body) {
      return new Response(webDavResponse.body, {
        status: 200,
        headers,
      });
    }

    const body = await webDavResponse.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Không thể tải file NAS.";

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
