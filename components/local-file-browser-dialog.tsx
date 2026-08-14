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
 * Picker for files sitting directly in LOCAL_FILE_ROOT on the machine that runs
 * the app + worker. Deliberately flat: no folder tree, no navigation — the
 * configured root is the whole world, so a plain list is the whole UI.
 */

export type LocalFileEntry = {
  name: string;
  size: number | null;
  lastModified: string | null;
};

export type LocalFileListing = {
  configured: boolean;
  root: string | null;
  files: LocalFileEntry[];
};

type LocalFileSelection = {
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
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const loadListing = useCallback(async (resetFilters = false) => {
    if (resetFilters) {
      setSearchQuery("");
      setSelectedFileName(null);
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

  const visibleFiles = useMemo(() => {
    const files = listing?.files ?? [];
    const normalizedQuery = searchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return files;
    }

    return files.filter((file) =>
      file.name.toLowerCase().includes(normalizedQuery)
    );
  }, [listing, searchQuery]);

  const selectedFile = useMemo(
    () => listing?.files.find((file) => file.name === selectedFileName) ?? null,
    [listing, selectedFileName]
  );

  function handleConfirmSelection() {
    if (!selectedFile) {
      return;
    }

    onSelectFile({ fileName: selectedFile.name, fileSize: selectedFile.size });
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
                Chỉ hiện file .csv/.txt nằm trực tiếp trong thư mục đã cấu hình.
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
                      const isSelected = selectedFileName === file.name;

                      return (
                        <TableRow
                          key={file.name}
                          data-state={isSelected ? "selected" : undefined}
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-sky-50/40",
                            isSelected && "bg-sky-50/70"
                          )}
                          onClick={() => setSelectedFileName(file.name)}
                        >
                          <TableCell className="align-top">
                            <span className="flex min-w-0 items-center gap-3">
                              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                                <FileText className="size-4" />
                              </span>
                              <span className="min-w-0 truncate font-medium text-slate-900">
                                {file.name}
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
