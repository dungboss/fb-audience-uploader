import { NextResponse } from "next/server";

import {
  getClientSafeError,
  getDefaultAdAccountId,
  listAdAccounts,
} from "@/app/api/audiences/meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Lists the ad accounts the configured access token can reach so the dashboard
// can present a picker instead of relying on a hardcoded FACEBOOK_AD_ACCOUNT_ID.
export async function GET(request: Request) {
  try {
    const tokenId =
      new URL(request.url).searchParams.get("tokenId") ?? undefined;
    const adAccounts = await listAdAccounts({ tokenId });

    return NextResponse.json(
      { adAccounts, defaultAdAccountId: getDefaultAdAccountId() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể tải danh sách ad account từ Meta."
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
