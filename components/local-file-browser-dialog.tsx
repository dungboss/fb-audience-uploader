"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, FileText, Loader2, RefreshCcw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatWebDavDate, formatWebDavSize } from "@/lib/webdav";

/**
 * Picker for files under LOCAL_FILE_ROOT on the machine that runs the app +
 * worker. Sub-folders are walked and flattened into one list (each row shows
 * its folder) rather than given a navigable tree: the configured root is the
 * whole world, so a searchable flat list is enough.
 */

export type LocalFileEntry = {
  /** Path relative to LOCAL_FILE_ROOT — what a job stores ("1/roth.txt"). */
  path: string;
  /** Base name, shown to the user and used for the audience name. */
  name: string;
  /** Containing folder relative to the root, "" when directly in the root. */
  folder: string;
  size: number | null;
  lastModified: string | null;
};

export type LocalFileListing = {
  configured: boolean;
  root: string | null;
  files: LocalFileEntry[];
};

type LocalFileSelection = {
  /** Relative path, stored on the job. */
  filePath: string;
  /** Base name, for display and the audience name. */
  fileName: string;
  fileSize: number | null;
};

type LocalFileBrowserDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (selection: LocalFileSelection) => void;
};

export async function fetchLocalFileListing(): Promise<LocalFileListing> {
  const response = await fetch("/api/local/entries", { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as
    | LocalFileListing
    | { error?: string };

  if (!response.ok) {
    throw new Error(
      ("error" in payload && payload.error) || "Không thể đọc thư mục local."
    );
  }

  return payload as LocalFileListing;
}

export function LocalFileBrowserDialog({
  isOpen,
  onClose,
  onSelectFile,
}: LocalFileBrowserDialogProps) {
  const [listing, setListing] = useState<LocalFileListing | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  // null = show every folder.
  const [folderFilter, setFolderFilter] = useState<string | null>(null);

  const loadListing = useCallback(async (resetFilters = false) => {
    if (resetFilters) {
      setSearchQuery("");
      setSelectedFilePath(null);
      setFolderFilter(null);
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      setListing(await fetchLocalFileListing());
    } catch (error) {
      setListing(null);
      setErrorMessage(
        error instanceof Error ? error.message : "Không thể đọc thư mục local."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // Reopening always starts from a clean list — the folder may have changed
    // since last time. Deferred (like the NAS browser does) so the state update
    // lands outside the effect body instead of cascading a render.
    queueMicrotask(() => {
      void loadListing(true);
    });
  }, [isOpen, loadListing]);

  const folders = useMemo(
    () => [...new Set((listing?.files ?? []).map((file) => file.folder))].sort(),
    [listing]
  );

  const visibleFiles = useMemo(() => {
    const files = listing?.files ?? [];
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return files.filter((file) => {
      if (folderFilter !== null && file.folder !== folderFilter) {
        return false;
      }
      // Search matches the folder too, so "1/" narrows to that sub-folder.
      return !normalizedQuery || file.path.toLowerCase().includes(normalizedQuery);
    });
  }, [listing, searchQuery, folderFilter]);

  const selectedFile = useMemo(
    () => listing?.files.find((file) => file.path === selectedFilePath) ?? null,
    [listing, selectedFilePath]
  );

  function handleConfirmSelection() {
    if (!selectedFile) {
      return;
    }

    onSelectFile({
      filePath: selectedFile.path,
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
    });
    onClose();
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-4xl overflow-hidden p-0" showCloseButton>
        <div className="flex max-h-[90vh] flex-col">
          <div className="border-b border-border/70 px-6 pt-6 pb-4 pr-12">
            <DialogHeader className="pr-0">
              <DialogTitle>Chọn file từ máy này</DialogTitle>
              <DialogDescription>
                File .csv/.txt trong thư mục đã cấu hình, kể cả thư mục con.
                Bỏ file vào đó rồi bấm Làm mới.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono">
                {listing?.root ?? "—"}
              </Badge>
              <Badge variant="secondary">
                {`${listing?.files.length ?? 0} file`}
              </Badge>
            </div>

            {folders.length > 1 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[null, ...folders].map((folder) => {
                  const count =
                    folder === null
                      ? listing?.files.length ?? 0
                      : (listing?.files ?? []).filter((f) => f.folder === folder).length;
                  const label =
                    folder === null ? "Tất cả" : folder || "Thư mục gốc";
                  return (
                    <button
                      key={folder ?? "(all)"}
                      type="button"
                      onClick={() => {
                        setFolderFilter(folder);
                        setSelectedFilePath(null);
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        folderFilter === folder
                          ? "border-sky-200 bg-sky-50 text-sky-800"
                          : "border-border bg-background text-muted-foreground hover:border-sky-200 hover:text-foreground"
                      )}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 border-b border-border/70 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadListing()}
              disabled={isLoading}
            >
              <RefreshCcw className="size-4" />
              Làm mới
            </Button>

            <div className="relative w-full sm:min-w-72 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9"
                placeholder="Tìm theo tên file"
                disabled={isLoading}
              />
            </div>
          </div>

          {errorMessage ? (
            <div className="flex gap-3 border-b border-amber-200 bg-amber-50 px-6 py-3 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Không thể đọc thư mục local</p>
                <p className="text-sm leading-6">{errorMessage}</p>
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="overflow-hidden rounded-2xl border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/35">
                    <TableHead>Tên</TableHead>
                    <TableHead className="w-36">Kích thước</TableHead>
                    <TableHead className="w-52">Cập nhật</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && !listing ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-12">
                        <div className="flex items-center justify-center gap-3 text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Đang đọc thư mục...
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : visibleFiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-12">
                        <div className="flex flex-col items-center gap-3 text-center">
                          <div className="flex size-12 items-center justify-center rounded-2xl border bg-muted/40">
                            <FileText className="size-5 text-muted-foreground" />
                          </div>
                          <p className="font-medium">
                            {searchQuery.trim()
                              ? "Không có file nào khớp từ khóa."
                              : "Thư mục này chưa có file CSV/TXT nào."}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleFiles.map((file) => {
                      const isSelected = selectedFilePath === file.path;

                      return (
                        <TableRow
                          key={file.path}
                          data-state={isSelected ? "selected" : undefined}
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-sky-50/40",
                            isSelected && "bg-sky-50/70"
                          )}
                          onClick={() => setSelectedFilePath(file.path)}
                        >
                          <TableCell className="align-top">
                            <span className="flex min-w-0 items-center gap-3">
                              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                                <FileText className="size-4" />
                              </span>
                              <span className="min-w-0 truncate">
                                <span className="block truncate font-medium text-slate-900">
                                  {file.name}
                                </span>
                                {file.folder ? (
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {file.folder}/
                                  </span>
                                ) : null}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="align-top text-muted-foreground">
                            {formatWebDavSize(file.size)}
                          </TableCell>
                          <TableCell className="align-top text-muted-foreground">
                            {formatWebDavDate(file.lastModified)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-6 py-4">
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button
                type="button"
                onClick={() => handleConfirmSelection()}
                disabled={!selectedFile || isLoading}
              >
                <FileText className="size-4" />
                Chọn file
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
