import type { LocalFileEntry } from "@/components/local-file-browser-dialog";

/**
 * Round-robin assignment of files to ad accounts for bulk audience creation.
 * Pure and dependency-free so it can be reasoned about (and tested) on its own.
 */

export type BulkAdAccount = {
  /** act_<id>, the value a job stores as adAccountId. */
  id: string;
  accountId: string;
  name: string;
  /** Token that can reach this account — a job must carry the matching one. */
  tokenId: string;
  tokenLabel: string;
  /** False when Meta will refuse uploads (disabled, unsettled, closed...). */
  isUsable: boolean;
  /** Why it is unusable, e.g. "Bị vô hiệu hoá — vi phạm chính sách quảng cáo". */
  statusLabel: string | null;
};

export type BulkAssignment = {
  file: LocalFileEntry;
  account: BulkAdAccount;
};

/**
 * Deals files out to accounts one at a time, in the order given: with 10
 * accounts and 20 files every account gets exactly 2; with 13 files the first
 * three accounts get 2 and the rest get 1. Returns [] when either side is empty.
 */
export function assignFilesToAccounts(
  files: LocalFileEntry[],
  accounts: BulkAdAccount[]
): BulkAssignment[] {
  if (files.length === 0 || accounts.length === 0) {
    return [];
  }

  return files.map((file, index) => ({
    file,
    account: accounts[index % accounts.length],
  }));
}
