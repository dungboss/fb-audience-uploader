"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, FileText, Layers, Loader2, RefreshCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatWebDavSize } from "@/lib/webdav";
import {
  fetchLocalFileListing,
  type LocalFileEntry,
} from "@/components/local-file-browser-dialog";
import {
  assignFilesToAccounts,
  type BulkAdAccount,
} from "@/components/bulk-create-assignment";

/**
 * Bulk flow: pick many local files at once, create one "create" job per file,
 * and spread those jobs round-robin over the selected ad accounts. Kept as its
 * own dialog so the single-audience form stays untouched.
 */

type BulkCreateAudiencesDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
};

type CreateOutcome = { fileName: string; ok: boolean; error?: string };

export function BulkCreateAudiencesDialog({
  isOpen,
  onClose,
  onCreated,
}: BulkCreateAudiencesDialogProps) {
  const [files, setFiles] = useState<LocalFileEntry[]>([]);
  const [accounts, setAccounts] = useState<BulkAdAccount[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<CreateOutcome[]>([]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setOutcomes([]);

    try {
      const [listing, accountsResponse] = await Promise.all([
        fetchLocalFileListing(),
        fetchAllAdAccounts(),
      ]);

      setFiles(listing.files);
      setAccounts(accountsResponse.adAccounts);
      // Everything is selected by default — deselecting is the exception.
      setSelectedFiles(new Set(listing.files.map((file) => file.path)));
      setSelectedAccounts(new Set(accountsResponse.adAccounts.map((a) => a.id)));
      setWarnings(
        accountsResponse.tokenErrors.map(
          (e) => `${e.tokenLabel}: ${e.message}`
        )
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Không tải được dữ liệu."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    queueMicrotask(() => void load());
  }, [isOpen, load]);

  // Folders present in the listing; null means "no filter".
  const folders = useMemo(
    () => [...new Set(files.map((file) => file.folder))].sort(),
    [files]
  );
  const visibleFiles = useMemo(
    () =>
      folderFilter === null
        ? files
        : files.filter((file) => file.folder === folderFilter),
    [files, folderFilter]
  );

  // Switching folder re-selects exactly that folder's files, so "only folder 1"
  // is a single click instead of unticking everything else.
  function selectFolder(folder: string | null) {
    setFolderFilter(folder);
    const next = folder === null ? files : files.filter((f) => f.folder === folder);
    setSelectedFiles(new Set(next.map((f) => f.path)));
  }

  const chosenFiles = useMemo(
    () => files.filter((file) => selectedFiles.has(file.path)),
    [files, selectedFiles]
  );
  const chosenAccounts = useMemo(
    () => accounts.filter((account) => selectedAccounts.has(account.id)),
    [accounts, selectedAccounts]
  );

  // Preview of the exact assignment that will be submitted.
  const assignments = useMemo(
    () => assignFilesToAccounts(chosenFiles, chosenAccounts),
    [chosenFiles, chosenAccounts]
  );

  const perAccountCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assignments) {
      counts.set(a.account.id, (counts.get(a.account.id) ?? 0) + 1);
    }
    return counts;
  }, [assignments]);

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  async function handleCreate() {
    if (assignments.length === 0) return;

    setIsSubmitting(true);
    setOutcomes([]);
    const results: CreateOutcome[] = [];

    // Sequential on purpose: one failing file must not abort the rest, and the
    // outcome list stays in the order the user sees.
    for (const { file, account } of assignments) {
      try {
        const response = await fetch("/api/upload-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "create",
            sourceType: "local",
            nasFilePath: file.path,
            fileSize: file.size,
            // Audience name = file name without its extension.
            name: file.name.replace(/\.[^/.]+$/, ""),
            adAccountId: account.id,
            adAccountName: account.name,
            tokenId: account.tokenId,
            appName: account.tokenLabel,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Tạo job thất bại.");
        results.push({ fileName: file.path, ok: true });
      } catch (error) {
        results.push({
          fileName: file.path,
          ok: false,
          error: error instanceof Error ? error.message : "Lỗi không rõ",
        });
      }
      setOutcomes([...results]);
    }

    setIsSubmitting(false);
    onCreated();

    // Close only when every job was created; otherwise keep the failures visible.
    if (results.every((r) => r.ok)) {
      onClose();
    }
  }

  const failedCount = outcomes.filter((o) => !o.ok).length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="max-w-5xl overflow-hidden p-0" showCloseButton>
        <div className="flex max-h-[90vh] flex-col">
          <div className="border-b border-border/70 px-6 pt-6 pb-4 pr-12">
            <DialogHeader className="pr-0">
              <DialogTitle>Tạo nhiều audience cùng lúc</DialogTitle>
              <DialogDescription>
                Mỗi file thành một audience riêng (tên lấy theo tên file), rồi
                chia lần lượt cho các ad account đã chọn.
              </DialogDescription>
            </DialogHeader>
          </div>

          {errorMessage ? (
            <div className="flex gap-3 border-b border-red-200 bg-red-50 px-6 py-3 text-red-900">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p className="text-sm leading-6">{errorMessage}</p>
            </div>
          ) : null}

          {warnings.map((warning) => (
            <div
              key={warning}
              className="flex gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2 text-amber-900"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p className="text-sm leading-6">{warning}</p>
            </div>
          ))}

          <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-2">
            <section className="flex min-h-0 flex-col border-r border-border/70">
              <SectionHeader
                title="File local"
                count={`${chosenFiles.length}/${visibleFiles.length}`}
                onAll={() =>
                  setSelectedFiles(new Set(visibleFiles.map((f) => f.path)))
                }
                onNone={() => setSelectedFiles(new Set())}
                disabled={isLoading || isSubmitting}
              />
              {folders.length > 1 ? (
                <div className="flex flex-wrap gap-1.5 border-b border-border/70 px-6 py-2">
                  <FolderChip
                    label={`Tất cả (${files.length})`}
                    active={folderFilter === null}
                    disabled={isSubmitting}
                    onClick={() => selectFolder(null)}
                  />
                  {folders.map((folder) => (
                    <FolderChip
                      key={folder || "(root)"}
                      label={`${folder || "Thư mục gốc"} (${
                        files.filter((f) => f.folder === folder).length
                      })`}
                      active={folderFilter === folder}
                      disabled={isSubmitting}
                      onClick={() => selectFolder(folder)}
                    />
                  ))}
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
                {isLoading ? (
                  <Loading label="Đang đọc thư mục..." />
                ) : visibleFiles.length === 0 ? (
                  <Empty label="Không có file CSV/TXT nào ở đây." />
                ) : (
                  visibleFiles.map((file) => (
                    <Row
                      key={file.path}
                      checked={selectedFiles.has(file.path)}
                      disabled={isSubmitting}
                      onToggle={() => setSelectedFiles((s) => toggle(s, file.path))}
                      title={file.name}
                      subtitle={[file.folder, formatWebDavSize(file.size)]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  ))
                )}
              </div>
            </section>

            <section className="flex min-h-0 flex-col">
              <SectionHeader
                title="Ad account"
                count={`${chosenAccounts.length}/${accounts.length}`}
                onAll={() => setSelectedAccounts(new Set(accounts.map((a) => a.id)))}
                onNone={() => setSelectedAccounts(new Set())}
                disabled={isLoading || isSubmitting}
              />
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
                {isLoading ? (
                  <Loading label="Đang đọc ad account..." />
                ) : accounts.length === 0 ? (
                  <Empty label="Không có ad account nào khả dụng." />
                ) : (
                  accounts.map((account) => {
                    const count = perAccountCount.get(account.id) ?? 0;
                    return (
                      <Row
                        key={account.id}
                        checked={selectedAccounts.has(account.id)}
                        disabled={isSubmitting}
                        onToggle={() => setSelectedAccounts((s) => toggle(s, account.id))}
                        title={account.name}
                        subtitle={account.tokenLabel}
                        trailing={
                          count > 0 ? (
                            <Badge variant="secondary">{count} job</Badge>
                          ) : null
                        }
                      />
                    );
                  })
                )}
              </div>
            </section>
          </div>

          {outcomes.length > 0 ? (
            <div className="max-h-32 overflow-y-auto border-t border-border/70 bg-muted/20 px-6 py-3 text-sm">
              {outcomes
                .filter((o) => !o.ok)
                .map((o) => (
                  <p key={o.fileName} className="text-red-700">
                    ✗ {o.fileName} — {o.error}
                  </p>
                ))}
              <p className="text-muted-foreground">
                Đã tạo {outcomes.filter((o) => o.ok).length}/{assignments.length} job
                {failedCount > 0 ? `, ${failedCount} lỗi` : ""}.
              </p>
            </div>
          ) : null}

          <DialogFooter className="border-t border-border/70 px-6 py-4">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {assignments.length > 0
                  ? `Sẽ tạo ${assignments.length} job trên ${chosenAccounts.length} ad account`
                  : "Chọn ít nhất 1 file và 1 ad account"}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void load()}
                  disabled={isLoading || isSubmitting}
                >
                  <RefreshCcw className="size-4" />
                  Làm mới
                </Button>
                <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                  Hủy
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={assignments.length === 0 || isSubmitting || isLoading}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Đang tạo {outcomes.length}/{assignments.length}...
                    </>
                  ) : (
                    <>
                      <Layers className="size-4" />
                      Tạo {assignments.length} job
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FolderChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60",
        active
          ? "border-sky-200 bg-sky-50 text-sky-800"
          : "border-border bg-background text-muted-foreground hover:border-sky-200 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function SectionHeader({
  title,
  count,
  onAll,
  onNone,
  disabled,
}: {
  title: string;
  count: string;
  onAll: () => void;
  onNone: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border/70 px-6 py-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <Badge variant="outline">{count}</Badge>
      </div>
      <div className="flex gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onAll} disabled={disabled}>
          Tất cả
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onNone} disabled={disabled}>
          Bỏ hết
        </Button>
      </div>
    </div>
  );
}

function Row({
  checked,
  disabled,
  onToggle,
  title,
  subtitle,
  trailing,
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string | null;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sky-50/50",
        checked && "bg-sky-50/40"
      )}
    >
      <Checkbox checked={checked} disabled={disabled} className="pointer-events-none" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle ? (
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      {trailing}
    </button>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <FileText className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

async function fetchAllAdAccounts(): Promise<{
  adAccounts: BulkAdAccount[];
  tokenErrors: { tokenLabel: string; message: string }[];
}> {
  const response = await fetch("/api/facebook/ad-accounts/all", { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as {
    adAccounts?: BulkAdAccount[];
    tokenErrors?: { tokenLabel: string; message: string }[];
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || "Không tải được danh sách ad account.");
  }

  return {
    adAccounts: payload.adAccounts ?? [],
    tokenErrors: payload.tokenErrors ?? [],
  };
}
