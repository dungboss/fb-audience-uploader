import { NextResponse } from "next/server";

import { getClientSafeError, listAdAccounts } from "@/app/api/audiences/meta";
import { listFbTokens } from "@/lib/audience-upload/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Every ad account reachable by ANY stored token, each tagged with the token
 * that can reach it. The regular /ad-accounts route is scoped to one token,
 * which is fine for the single-audience form; bulk creation needs to spread
 * jobs across accounts belonging to different tokens, and a job must carry the
 * token that can actually reach its account.
 *
 * A token that fails (expired, revoked) is reported per-token instead of
 * failing the whole listing — the other tokens' accounts stay usable.
 */
export async function GET() {
  try {
    const tokens = await listFbTokens();

    const results = await Promise.all(
      tokens.map(async (token) => {
        try {
          const accounts = await listAdAccounts({ tokenId: token.id });
          return {
            accounts: accounts.map((account) => ({
              ...account,
              tokenId: token.id,
              tokenLabel: token.label,
            })),
            error: null,
          };
        } catch (error) {
          const safeError = getClientSafeError(
            error,
            "Không thể tải ad account của token này."
          );
          return {
            accounts: [],
            error: { tokenId: token.id, tokenLabel: token.label, message: safeError.message },
          };
        }
      })
    );

    return NextResponse.json(
      {
        adAccounts: results.flatMap((result) => result.accounts),
        tokenErrors: results.map((result) => result.error).filter(Boolean),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const safeError = getClientSafeError(
      error,
      "Không thể tải danh sách ad account."
    );

    return NextResponse.json(
      { error: safeError.message, details: safeError.details },
      { status: safeError.status }
    );
  }
}
