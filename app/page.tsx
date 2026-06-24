"use client";

import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { Accept } from "react-dropzone";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import { toast } from "sonner";
import {
  AlertCircle,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { NasFileBrowserDialog } from "@/components/nas-file-browser-dialog";
import { cn } from "@/lib/utils";

const DROPZONE_ACCEPT: Accept = {
  "text/csv": [".csv"],
  "text/plain": [".txt"],
  "application/vnd.ms-excel": [".csv"],
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HASH_BATCH_SIZE = 400;
const CLIENT_UPLOAD_CHUNK_SIZE = 10_000;
const JOB_POLL_DELAY_MS = 250;
const numberFormatter = new Intl.NumberFormat("vi-VN");

type AudienceAvailability = "ready" | "populating";
type AudienceJobKind = "create" | "append";
type AudienceJobStatus =
  | "draft"
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

type Audience = {
  id: string;
  name: string;
  description: string;
  subtype: string;
  availability: AudienceAvailability;
  sizeUpperBound: number | null;
  sizeLowerBound: number | null;
  timeUpdated: string | null;
};

type FileSelection = {
  file: File;
  fileName: string;
  fileSize: number;
  source: "local" | "nas";
  sourceLabel: string | null;
};

type NasBrowseTarget = "create" | "update";

type UploadPipelineSummary = {
  totalParts: number;
  uniqueHashCount: number;
  duplicateCount: number;
};

type ProgressState = {
  step: string;
  description: string;
  value: number;
};

type AudienceUploadJob = {
  id: string;
  kind: AudienceJobKind;
  status: AudienceJobStatus;
  name: string;
  description: string;
  fileName: string;
  audienceId: string | null;
  receivedPartCount: number;
  processedPartCount: number;
  receivedHashCount: number;
  syncedHashCount: number;
  totalParts: number | null;
  totalHashes: number | null;
  duplicateCount: number;
  invalidEntryCount: number;
  lastSessionId: string | null;
  errorMessage: string | null;
  finalizedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AudienceListResponse = {
  audiences?: Audience[];
  error?: string;
};

type AudienceJobResponse = {
  job?: AudienceUploadJob;
  error?: string;
};

type UploadPartPresignResponse = {
  job?: AudienceUploadJob;
  uploadUrl?: string;
  objectKey?: string;
  expiresIn?: number;
  error?: string;
};

type DeleteAudienceResponse = {
  audienceId: string;
  deleted: boolean;
  error?: string;
};

export default function Home() {
  const [audienceName, setAudienceName] = useState(() => generateAudienceName());
  const [description, setDescription] = useState("");
  const [createFile, setCreateFile] = useState<FileSelection | null>(null);
  const [createProgress, setCreateProgress] = useState<ProgressState | null>(null);
  const [isCreateSubmitting, setIsCreateSubmitting] = useState(false);

  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [selectedAudience, setSelectedAudience] = useState<Audience | null>(null);
  const [isAddUsersDialogOpen, setIsAddUsersDialogOpen] = useState(false);
  const [updateFile, setUpdateFile] = useState<FileSelection | null>(null);
  const [updateProgress, setUpdateProgress] = useState<ProgressState | null>(null);
  const [isUpdateSubmitting, setIsUpdateSubmitting] = useState(false);
  const [nasBrowseTarget, setNasBrowseTarget] = useState<NasBrowseTarget | null>(
    null
  );
  const [isNasBrowserOpen, setIsNasBrowserOpen] = useState(false);
  const [nasBrowserPath, setNasBrowserPath] = useState("/");

  const [deleteTargets, setDeleteTargets] = useState<Audience[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedIdSet = new Set(selectedIds);
  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase();
  const filteredAudiences = audiences.filter((audience) => {
    return (
      !normalizedSearchQuery ||
      audience.name.toLowerCase().includes(normalizedSearchQuery) ||
      audience.id.toLowerCase().includes(normalizedSearchQuery)
    );
  });

  const selectedVisibleCount = filteredAudiences.filter((audience) =>
    selectedIdSet.has(audience.id)
  ).length;
  const allVisibleSelected =
    filteredAudiences.length > 0 && selectedVisibleCount === filteredAudiences.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const selectedAudiences = audiences.filter((audience) =>
    selectedIdSet.has(audience.id)
  );

  function applyAudienceResult(nextAudiences: Audience[]) {
    startTransition(() => {
      setAudiences(nextAudiences);
      setSelectedIds((current) =>
        current.filter((id) =>
          nextAudiences.some((audience) => audience.id === id)
        )
      );
    });
  }

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      setIsBootstrapping(true);

      try {
        const nextAudiences = await fetchAudiencesFromApi();

        if (isCancelled) {
          return;
        }

        applyAudienceResult(nextAudiences);
        setServerError(null);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        const message = getErrorMessage(
          error,
          "Không thể tải danh sách audience từ server."
        );
        setServerError(message);
        toast.error("Không thể tải dashboard.", {
          description: message,
        });
      } finally {
        if (!isCancelled) {
          setIsBootstrapping(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  async function refreshAudiences(options?: { silent?: boolean }) {
    const isSilent = options?.silent ?? false;

    if (isSilent) {
      setIsRefreshing(true);
    } else {
      setIsBootstrapping(true);
    }

    try {
      const nextAudiences = await fetchAudiencesFromApi();
      applyAudienceResult(nextAudiences);
      setServerError(null);
    } catch (error) {
      const message = getErrorMessage(
        error,
        "Không thể làm mới danh sách audience."
      );
      setServerError(message);
      toast.error("Làm mới dữ liệu thất bại.", {
        description: message,
      });
    } finally {
      if (isSilent) {
        setIsRefreshing(false);
      } else {
        setIsBootstrapping(false);
      }
    }
  }

  function buildFileSelection(
    file: File,
    source: FileSelection["source"],
    sourceLabel: string | null = null
  ): FileSelection {
    return {
      file,
      fileName: file.name,
      fileSize: file.size,
      source,
      sourceLabel,
    };
  }

  async function handleCreateFileSelected(file: File) {
    setCreateFile(buildFileSelection(file, "local"));
    setCreateProgress(null);
  }

  async function handleUpdateFileSelected(file: File) {
    setUpdateFile(buildFileSelection(file, "local"));
    setUpdateProgress(null);
  }

  function openNasBrowser(target: NasBrowseTarget) {
    setNasBrowseTarget(target);
    setIsNasBrowserOpen(true);
  }

  function closeNasBrowser() {
    setIsNasBrowserOpen(false);
    setNasBrowseTarget(null);
  }

  async function handleNasFileSelected(file: File, filePath: string) {
    if (!nasBrowseTarget) {
      throw new Error("Chưa xác định nơi nhận file từ NAS.");
    }

    const selection = buildFileSelection(file, "nas", filePath);

    if (nasBrowseTarget === "create") {
      setCreateFile(selection);
      setCreateProgress(null);
      return;
    }

    setUpdateFile(selection);
    setUpdateProgress(null);
  }

  async function handleCreateAudience() {
    if (!createFile) {
      toast.error("Hãy chọn file dữ liệu trước khi đồng bộ.");
      return;
    }

    if (!audienceName.trim()) {
      toast.error("Tên đối tượng là bắt buộc.");
      return;
    }

    setIsCreateSubmitting(true);
    setCreateProgress({
      step: "Đang khởi tạo job...",
      description: "Server đang tạo upload job để nhận các shard hash.",
      value: 4,
    });

    try {
      const job = await createAudienceJob({
        kind: "create",
        name: audienceName.trim(),
        description: description.trim(),
        fileName: createFile.fileName,
      });

      const summary = await uploadFileToJob({
        file: createFile.file,
        jobId: job.id,
        setProgress: setCreateProgress,
      });

      await finalizeAudienceJob(job.id, summary);

      setCreateProgress({
        step: "Đang xếp hàng xử lý...",
        description: "Các shard đã ở R2, worker nền sẽ đồng bộ lần lượt lên Meta.",
        value: 64,
      });

      const completedJob = await runAudienceJobUntilComplete(
        job.id,
        setCreateProgress
      );

      setCreateProgress({
        step: "Đang làm mới dashboard...",
        description: "Đang tải lại danh sách audience mới nhất từ Meta.",
        value: 96,
      });
      await refreshAudiences({ silent: true });
      setCreateProgress({
        step: "Hoàn tất",
        description: `Audience ${completedJob.audienceId} đã nhận ${formatNumber(completedJob.syncedHashCount)} email hash.`,
        value: 100,
      });

      toast.success("Tạo audience thành công.", {
        description: `${formatNumber(completedJob.syncedHashCount)} hash đã được đồng bộ lên Meta.`,
      });

      setAudienceName(generateAudienceName());
      setDescription("");
      setCreateFile(null);
      dismissProgressLater(setCreateProgress);
    } catch (error) {
      const message = getErrorMessage(
        error,
        "Không thể tạo audience mới trên Meta."
      );
      setCreateProgress({
        step: "Đồng bộ thất bại",
        description: message,
        value: 0,
      });
      dismissProgressLater(setCreateProgress, 2400);
      toast.error("Tạo audience thất bại.", {
        description: message,
      });
    } finally {
      setIsCreateSubmitting(false);
    }
  }

  function openAddUsersDialog(audience: Audience) {
    setSelectedAudience(audience);
    setUpdateFile(null);
    setUpdateProgress(null);
    setIsAddUsersDialogOpen(true);
  }

  async function handleAppendUsers() {
    if (!selectedAudience) {
      toast.error("Chưa có audience nào được chọn.");
      return;
    }

    if (!updateFile) {
      toast.error("Hãy chọn file CSV/TXT trước khi nạp thêm dữ liệu.");
      return;
    }

    setIsUpdateSubmitting(true);
    setUpdateProgress({
      step: "Đang khởi tạo job...",
      description: `Đang tạo job nạp thêm dữ liệu cho ${selectedAudience.name}.`,
      value: 4,
    });

    try {
      const job = await createAudienceJob({
        kind: "append",
        audienceId: selectedAudience.id,
        fileName: updateFile.fileName,
      });

      const summary = await uploadFileToJob({
        file: updateFile.file,
        jobId: job.id,
        setProgress: setUpdateProgress,
      });

      await finalizeAudienceJob(job.id, summary);

      setUpdateProgress({
        step: "Đang xếp hàng xử lý...",
        description: `Các shard đã ở R2, worker sẽ nạp dần vào audience ${selectedAudience.id}.`,
        value: 64,
      });

      const completedJob = await runAudienceJobUntilComplete(
        job.id,
        setUpdateProgress
      );

      setUpdateProgress({
        step: "Đang làm mới dashboard...",
        description: "Audience đã nhận thêm dữ liệu, đang tải lại trạng thái mới nhất.",
        value: 96,
      });
      await refreshAudiences({ silent: true });
      setUpdateProgress({
        step: "Hoàn tất",
        description: `${formatNumber(completedJob.syncedHashCount)} email hash đã được nạp thêm vào audience.`,
        value: 100,
      });

      toast.success("Bổ sung dữ liệu thành công.", {
        description: `${formatNumber(completedJob.syncedHashCount)} hash đã được gửi lên Meta.`,
      });

      dismissProgressLater(setUpdateProgress);
      setUpdateFile(null);
      setIsAddUsersDialogOpen(false);
      setSelectedAudience(null);
    } catch (error) {
      const message = getErrorMessage(
        error,
        "Không thể thêm dữ liệu vào audience hiện tại."
      );
      setUpdateProgress({
        step: "Đồng bộ thất bại",
        description: message,
        value: 0,
      });
      dismissProgressLater(setUpdateProgress, 2400);
      toast.error("Bổ sung dữ liệu thất bại.", {
        description: message,
      });
    } finally {
      setIsUpdateSubmitting(false);
    }
  }

  function toggleAudienceSelection(audienceId: string, checked: boolean) {
    setSelectedIds((current) => {
      const nextSelection = new Set(current);

      if (checked) {
        nextSelection.add(audienceId);
      } else {
        nextSelection.delete(audienceId);
      }

      return Array.from(nextSelection);
    });
  }

  function toggleSelectAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const nextSelection = new Set(current);

      for (const audience of filteredAudiences) {
        if (checked) {
          nextSelection.add(audience.id);
        } else {
          nextSelection.delete(audience.id);
        }
      }

      return Array.from(nextSelection);
    });
  }

  function promptDelete(targets: Audience[]) {
    if (targets.length === 0) {
      toast.error("Hãy chọn ít nhất một audience để xóa.");
      return;
    }

    setDeleteTargets(targets);
    setIsDeleteDialogOpen(true);
  }

  async function handleDeleteAudiences() {
    if (deleteTargets.length === 0) {
      return;
    }

    setIsDeleting(true);

    const results = await Promise.allSettled(
      deleteTargets.map(async (audience) => {
        const response = await fetch(`/api/audiences/${audience.id}`, {
          method: "DELETE",
        });
        const payload = await readJsonSafe<DeleteAudienceResponse>(response);

        if (!response.ok || !payload.deleted) {
          throw new Error(
            payload.error || `Không thể xóa audience ${audience.name}.`
          );
        }

        return audience;
      })
    );

    const failedTargets = results.flatMap((result, index) =>
      result.status === "rejected" ? [deleteTargets[index]] : []
    );
    const deletedCount = results.length - failedTargets.length;

    try {
      if (deletedCount > 0) {
        await refreshAudiences({ silent: true });
        toast.success("Đã xóa audience.", {
          description:
            deletedCount === 1
              ? "Audience đã được xóa khỏi ad account."
              : `${formatNumber(deletedCount)} audience đã được xóa khỏi ad account.`,
        });
      }

      if (failedTargets.length > 0) {
        setDeleteTargets(failedTargets);
        toast.error("Một số audience chưa xóa được.", {
          description: "Hãy kiểm tra lại quyền hoặc trạng thái xử lý của Meta.",
        });
      } else {
        setDeleteTargets([]);
        setIsDeleteDialogOpen(false);
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_24%),linear-gradient(180deg,#f8fafc_0%,#eef2f7_48%,#f8fafc_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <main className="space-y-6">
          <Card className="rounded-[28px] border-white/60 bg-white/85 shadow-lg shadow-slate-950/5 backdrop-blur">
            <CardHeader className="pb-3">
              <CardTitle>Tạo mới Custom Audience</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tên đối tượng</label>
                    <Input
                      value={audienceName}
                      onChange={(event) => setAudienceName(event.target.value)}
                      placeholder="Ví dụ: Khách hàng VIP tháng 06"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Mô tả</label>
                    <Textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      className="min-h-20"
                      placeholder="Mô tả nguồn dữ liệu, giai đoạn chiến dịch hoặc logic làm mới audience."
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <UploadDropzone
                    variant="dense"
                    disabled={isCreateSubmitting}
                    title="Kéo thả file CSV/TXT hoặc chọn từ NAS"
                    selection={createFile}
                    onBrowseNas={() => openNasBrowser("create")}
                    onFileSelected={handleCreateFileSelected}
                  />

                  <Button
                    type="button"
                    onClick={handleCreateAudience}
                    disabled={!createFile || isCreateSubmitting}
                    className="w-full"
                  >
                    {isCreateSubmitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Đang đồng bộ...
                      </>
                    ) : (
                      <>
                        <Plus className="size-4" />
                        Tạo audience mới
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <ProgressPanel progress={createProgress} />
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-white/60 bg-white/85 shadow-lg shadow-slate-950/5 backdrop-blur">
            <CardHeader className="gap-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-end">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative w-full sm:min-w-80">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className="pl-9"
                      placeholder="Tìm kiếm theo tên hoặc ID audience"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void refreshAudiences({ silent: true })}
                    disabled={isRefreshing || isBootstrapping}
                  >
                    {isRefreshing ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Đang tải...
                      </>
                    ) : (
                      <>
                        <RefreshCcw className="size-4" />
                        Làm mới
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => promptDelete(selectedAudiences)}
                    disabled={selectedIds.length === 0 || isDeleting}
                  >
                    <Trash2 className="size-4" />
                    Xóa đã chọn
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {serverError ? (
                <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">
                      Dashboard chưa kết nối được với Meta API
                    </p>
                    <p className="text-sm leading-6">{serverError}</p>
                  </div>
                </div>
              ) : null}

              {selectedIds.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="warning">
                    Đã chọn {formatNumber(selectedIds.length)}
                  </Badge>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-2xl border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/35">
                      <TableHead className="w-12">
                        <Checkbox
                          aria-label="Chọn tất cả audience đang hiển thị"
                          checked={allVisibleSelected}
                          indeterminate={someVisibleSelected}
                          onCheckedChange={toggleSelectAllVisible}
                        />
                      </TableHead>
                      <TableHead>Tên đối tượng</TableHead>
                      <TableHead>Mô tả</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Quy mô ước tính</TableHead>
                      <TableHead className="text-right">Hành động</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isBootstrapping ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10">
                          <div className="flex items-center justify-center gap-3 text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            Đang tải danh sách Custom Audiences...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : filteredAudiences.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-12">
                          <div className="flex flex-col items-center gap-3 text-center">
                            <div className="flex size-12 items-center justify-center rounded-2xl border bg-muted/40">
                              <Users className="size-5 text-muted-foreground" />
                            </div>
                            <div className="space-y-1">
                              <p className="font-medium">
                                Không có audience nào khớp bộ lọc hiện tại.
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Hãy tạo audience mới hoặc điều chỉnh từ khóa tìm kiếm.
                              </p>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAudiences.map((audience) => (
                        <TableRow
                          key={audience.id}
                          data-state={
                            selectedIdSet.has(audience.id) ? "selected" : undefined
                          }
                        >
                          <TableCell>
                            <Checkbox
                              aria-label={`Chọn audience ${audience.name}`}
                              checked={selectedIdSet.has(audience.id)}
                              onCheckedChange={(checked) =>
                                toggleAudienceSelection(audience.id, checked)
                              }
                            />
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="space-y-2">
                              <Button
                                type="button"
                                variant="link"
                                className="h-auto px-0 text-left text-sm font-semibold text-slate-900 hover:text-sky-700"
                                onClick={() => openAddUsersDialog(audience)}
                              >
                                {audience.name}
                              </Button>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline" className="font-mono">
                                  {audience.id}
                                </Badge>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-72 whitespace-normal text-sm text-muted-foreground">
                            {audience.description || "Chưa có mô tả"}
                          </TableCell>
                          <TableCell>
                            <AvailabilityBadge availability={audience.availability} />
                          </TableCell>
                          <TableCell className="font-medium">
                            {formatAudienceSize(audience)}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openAddUsersDialog(audience)}
                              >
                                <Upload className="size-4" />
                                Thêm người dùng
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => promptDelete([audience])}
                              >
                                <Trash2 className="size-4" />
                                Xóa
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>

      <Dialog
        open={isAddUsersDialogOpen}
        onOpenChange={(open) => {
          if (isUpdateSubmitting) {
            return;
          }

          setIsAddUsersDialogOpen(open);
          if (!open) {
            setSelectedAudience(null);
            setUpdateFile(null);
            setUpdateProgress(null);
          }
        }}
        disablePointerDismissal={isUpdateSubmitting}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Thêm người dùng vào audience hiện có</DialogTitle>
            <DialogDescription>
              {selectedAudience
                ? `${selectedAudience.name} • ${selectedAudience.id}`
                : "Chọn file CSV/TXT mới để nạp thêm EMAIL_SHA256 vào audience hiện tại."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-5">
            <UploadDropzone
              variant="compact"
              disabled={isUpdateSubmitting}
              title="Kéo thả file CSV/TXT hoặc chọn từ NAS"
              selection={updateFile}
              onBrowseNas={() => openNasBrowser("update")}
              onFileSelected={handleUpdateFileSelected}
            />

            <ProgressPanel progress={updateProgress} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsAddUsersDialogOpen(false);
                setSelectedAudience(null);
                setUpdateFile(null);
                setUpdateProgress(null);
              }}
              disabled={isUpdateSubmitting}
            >
              Hủy
            </Button>
            <Button
              type="button"
              onClick={handleAppendUsers}
              disabled={!updateFile || isUpdateSubmitting}
            >
              {isUpdateSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Đang nạp thêm...
                </>
              ) : (
                <>
                  <Upload className="size-4" />
                  Thêm người dùng
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NasFileBrowserDialog
        initialPath={nasBrowserPath}
        isOpen={isNasBrowserOpen}
        onClose={closeNasBrowser}
        onCurrentPathChange={(path) => {
          setNasBrowserPath(path);
        }}
        onSelectFile={handleNasFileSelected}
        rootLabel="NAS"
      />

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (isDeleting) {
            return;
          }

          setIsDeleteDialogOpen(open);
          if (!open) {
            setDeleteTargets([]);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa Custom Audience?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTargets.length === 1
                ? `Audience "${deleteTargets[0].name}" sẽ bị xóa hoàn toàn trên Meta.`
                : `${formatNumber(deleteTargets.length)} audience sẽ bị xóa hoàn toàn trên Meta.`}
              Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-4 max-h-40 overflow-y-auto rounded-2xl border bg-muted/25 p-3">
            <div className="space-y-2">
              {deleteTargets.map((audience) => (
                <div
                  key={audience.id}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{audience.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {audience.id}
                    </p>
                  </div>
                  <AvailabilityBadge availability={audience.availability} />
                </div>
              ))}
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Hủy</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteAudiences()}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Đang xóa...
                </>
              ) : (
                <>
                  <Trash2 className="size-4" />
                  Xác nhận xóa
                </>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UploadDropzone({
  disabled,
  title,
  onBrowseNas,
  selection,
  variant = "default",
  onFileSelected,
}: {
  disabled?: boolean;
  title: string;
  onBrowseNas?: () => void;
  selection: FileSelection | null;
  variant?: "default" | "compact" | "dense";
  onFileSelected: (file: File) => Promise<void>;
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: DROPZONE_ACCEPT,
    maxFiles: 1,
    multiple: false,
    disabled,
    onDrop: (acceptedFiles, rejectedFiles) => {
      if (rejectedFiles.length > 0) {
        toast.error("Chỉ chấp nhận file .csv hoặc .txt.");
      }

      const file = acceptedFiles[0];
      if (file) {
        void onFileSelected(file);
      }
    },
  });

  const isDense = variant === "dense";
  const isCompact = variant === "compact";

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          "group rounded-[24px] border border-dashed transition-colors",
          isDense
            ? "min-h-40 px-4 py-4"
            : isCompact
              ? "min-h-52 px-5 py-6"
              : "min-h-60 px-5 py-6",
          disabled
            ? "cursor-not-allowed border-border bg-muted/20 opacity-70"
            : "cursor-pointer border-border bg-muted/15 hover:border-sky-400 hover:bg-sky-500/[0.03]",
          isDragActive && "border-sky-500 bg-sky-500/5"
        )}
      >
        <input {...getInputProps()} />
        <div
          className={cn(
            "flex h-full flex-col items-center justify-center text-center",
            isDense ? "gap-3" : "gap-4"
          )}
        >
          <div
            className={cn(
              isDense
                ? "flex size-11 items-center justify-center rounded-xl border bg-background shadow-sm"
                : "flex size-14 items-center justify-center rounded-2xl border bg-background shadow-sm",
              isDragActive
                ? "border-sky-500 text-sky-600"
                : "border-border text-muted-foreground"
            )}
          >
            <Upload className={cn(isDense ? "size-4" : "size-5")} />
          </div>
          <div className="space-y-1">
            <p className={cn("font-medium", isDense ? "text-[13px]" : "text-sm")}>
              {isDragActive ? "Thả file vào đây để bắt đầu xử lý" : title}
            </p>
          </div>
        </div>
      </div>

      {selection ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{selection.fileName}</Badge>
            <Badge variant="secondary">{formatFileSize(selection.fileSize)}</Badge>
            <Badge
              variant={selection.source === "nas" ? "warning" : "outline"}
            >
              {selection.source === "nas" ? "NAS" : "Local"}
            </Badge>
          </div>
          {selection.sourceLabel ? (
            <p className="break-all text-xs text-muted-foreground">
              {selection.sourceLabel}
            </p>
          ) : null}
        </div>
      ) : null}

      {onBrowseNas ? (
        <Button
          type="button"
          variant="outline"
          onClick={onBrowseNas}
          disabled={disabled}
          className="w-full"
        >
          <FolderOpen className="size-4" />
          Chọn file từ NAS
        </Button>
      ) : null}
    </div>
  );
}

function ProgressPanel({ progress }: { progress: ProgressState | null }) {
  if (!progress) {
    return null;
  }

  return (
    <div className="rounded-2xl border bg-muted/30 p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">{progress.step}</p>
          <p className="text-sm text-muted-foreground">{progress.description}</p>
        </div>
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">
          {progress.value}%
        </span>
      </div>
      <Progress value={progress.value} className="gap-0" />
    </div>
  );
}

function AvailabilityBadge({
  availability,
}: {
  availability: AudienceAvailability;
}) {
  if (availability === "ready") {
    return <Badge variant="success">Ready</Badge>;
  }

  return <Badge variant="warning">Populating</Badge>;
}

async function uploadFileToJob({
  file,
  jobId,
  setProgress,
}: {
  file: File;
  jobId: string;
  setProgress: React.Dispatch<React.SetStateAction<ProgressState | null>>;
}): Promise<UploadPipelineSummary> {
  return new Promise((resolve, reject) => {
    let parseCursor = 0;
    const pendingEmails: string[] = [];
    const pendingHashes: string[] = [];
    let totalParts = 0;
    let duplicateCount = 0;
    const seenHashes = new Set<string>();
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    const finish = (summary: UploadPipelineSummary) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(summary);
    };

    const flushHashesToR2 = async (force: boolean) => {
      while (
        pendingHashes.length >= CLIENT_UPLOAD_CHUNK_SIZE ||
        (force && pendingHashes.length > 0)
      ) {
        const chunk = pendingHashes.splice(0, CLIENT_UPLOAD_CHUNK_SIZE);
        const parseRatio = file.size > 0 ? Math.min(parseCursor / file.size, 1) : 1;
        const partNumber = totalParts + 1;

        setProgress({
          step: "Đang tải shard lên R2...",
          description: `Đang gửi shard ${formatNumber(partNumber)} với ${formatNumber(chunk.length)} hash lên R2.`,
          value: Math.min(60, 42 + Math.round(parseRatio * 18)),
        });

        await uploadAudienceJobPart(jobId, totalParts, chunk);
        totalParts += 1;
        await waitFor(0);
      }
    };

    const flushEmails = async () => {
      if (pendingEmails.length === 0) {
        return;
      }

      const emailBatch = pendingEmails.splice(0, pendingEmails.length);
      const parseRatio = file.size > 0 ? Math.min(parseCursor / file.size, 1) : 1;

      const hashedBatch = await hashEmailList(emailBatch, (completed, total) => {
        const batchRatio = total === 0 ? 1 : completed / total;
        setProgress({
          step: "Đang mã hóa dữ liệu...",
          description: `Đã băm ${formatNumber(completed)} / ${formatNumber(total)} email trong lô hiện tại.`,
          value: Math.min(52, 20 + Math.round(parseRatio * 18 + batchRatio * 14)),
        });
      });

      for (const hash of hashedBatch) {
        if (seenHashes.has(hash)) {
          duplicateCount += 1;
          continue;
        }

        seenHashes.add(hash);
        pendingHashes.push(hash);
      }

      await flushHashesToR2(false);
    };

    const flushAll = async () => {
      await flushEmails();
      await flushHashesToR2(true);

      if (seenHashes.size === 0) {
        throw new Error("Không tìm thấy email hợp lệ trong file vừa tải lên.");
      }

      setProgress({
        step: "Đang chốt job...",
        description: `${formatNumber(totalParts)} shard hash đã sẵn sàng để worker đồng bộ lên Meta.`,
        value: 60,
      });

      finish({
        totalParts,
        uniqueHashCount: seenHashes.size,
        duplicateCount,
      });
    };

    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      worker: false,
      step: (results, parser) => {
        if (settled) {
          parser.abort();
          return;
        }

        parseCursor = results.meta.cursor;
        const row = Array.isArray(results.data) ? results.data : [];
        const emails = extractNormalizedEmailsFromCells(row);

        if (emails.length > 0) {
          pendingEmails.push(...emails);
        }

        const parseRatio = file.size > 0 ? Math.min(parseCursor / file.size, 1) : 1;

        if (pendingEmails.length >= HASH_BATCH_SIZE) {
          parser.pause();
          void flushEmails()
            .then(() => {
              if (!settled) {
                parser.resume();
              }
            })
            .catch((error) => {
              parser.abort();
              fail(error);
            });
          return;
        }

        setProgress({
          step: "Đang đọc file...",
          description: `PapaParse đang quét ${file.name} trực tiếp trên trình duyệt.`,
          value: Math.min(18, 8 + Math.round(parseRatio * 10)),
        });
      },
      complete: () => {
        void flushAll().catch(fail);
      },
      error: fail,
    });
  });
}

function extractNormalizedEmailsFromCells(cells: string[]) {
  const emails: string[] = [];

  for (const cell of cells) {
    const chunks = String(cell)
      .replace(/\uFEFF/g, "")
      .split(/[\s;|]+/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);

    for (const candidate of chunks) {
      if (EMAIL_PATTERN.test(candidate)) {
        emails.push(candidate);
      }
    }
  }

  return emails;
}

async function hashEmailList(
  emails: string[],
  onProgress: (completed: number, total: number) => void
) {
  const chunkSize = 250;
  const hashedEmails: string[] = [];

  for (let index = 0; index < emails.length; index += chunkSize) {
    const chunk = emails.slice(index, index + chunkSize);
    const hashedChunk = await Promise.all(chunk.map(hashSha256));
    hashedEmails.push(...hashedChunk);
    onProgress(Math.min(index + chunk.length, emails.length), emails.length);
    await waitFor(0);
  }

  return hashedEmails;
}

async function hashSha256(input: string) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function createAudienceJob(input: {
  kind: AudienceJobKind;
  fileName: string;
  name?: string;
  description?: string;
  audienceId?: string;
}) {
  const response = await fetch("/api/upload-jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await readJsonSafe<AudienceJobResponse>(response);

  if (!response.ok || !payload.job) {
    throw new Error(payload.error || "Không thể tạo upload job.");
  }

  return payload.job;
}

async function uploadAudienceJobPart(
  jobId: string,
  partIndex: number,
  hashedEmails: string[]
) {
  const presignResponse = await fetch(
    `/api/upload-jobs/${jobId}/parts/presign`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        partIndex,
      }),
    }
  );
  const presignPayload = await readJsonSafe<UploadPartPresignResponse>(
    presignResponse
  );

  if (
    !presignResponse.ok ||
    !presignPayload.uploadUrl ||
    !presignPayload.objectKey
  ) {
    throw new Error(presignPayload.error || "Không thể presign shard upload.");
  }

  const r2Response = await fetch(presignPayload.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(hashedEmails),
  });

  if (!r2Response.ok) {
    throw new Error("R2 từ chối shard upload hiện tại.");
  }

  const response = await fetch(`/api/upload-jobs/${jobId}/parts/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      partIndex,
      hashCount: hashedEmails.length,
      objectKey: presignPayload.objectKey,
    }),
  });
  const payload = await readJsonSafe<AudienceJobResponse>(response);

  if (!response.ok || !payload.job) {
    throw new Error(payload.error || "Không thể ack shard upload.");
  }

  return payload.job;
}

async function finalizeAudienceJob(
  jobId: string,
  summary: UploadPipelineSummary
) {
  const response = await fetch(`/api/upload-jobs/${jobId}/finalize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      totalParts: summary.totalParts,
      totalHashes: summary.uniqueHashCount,
      duplicateCount: summary.duplicateCount,
    }),
  });
  const payload = await readJsonSafe<AudienceJobResponse>(response);

  if (!response.ok || !payload.job) {
    throw new Error(payload.error || "Không thể chốt upload job.");
  }

  return payload.job;
}

async function runAudienceJobUntilComplete(
  jobId: string,
  setProgress: React.Dispatch<React.SetStateAction<ProgressState | null>>
) {
  while (true) {
    const response = await fetch(`/api/upload-jobs/${jobId}`, {
      cache: "no-store",
    });
    const payload = await readJsonSafe<AudienceJobResponse>(response);

    if (!response.ok || !payload.job) {
      throw new Error(payload.error || "Không thể xử lý upload job.");
    }

    const job = payload.job;
    setProgress(buildJobSyncProgress(job));

    if (job.status === "completed") {
      return job;
    }

    if (job.status === "failed") {
      throw new Error(job.errorMessage || "Meta từ chối job upload hiện tại.");
    }

    await waitFor(JOB_POLL_DELAY_MS);
  }
}

function buildJobSyncProgress(job: AudienceUploadJob): ProgressState {
  if (job.status === "queued") {
    return {
      step: "Đang chờ worker xử lý...",
      description: "BullMQ đã nhận job và đang chờ lượt đồng bộ lên Meta.",
      value: 66,
    };
  }

  if (job.kind === "create" && !job.audienceId) {
    return {
      step: "Đang khởi tạo đối tượng trên Meta...",
      description: "Worker đang tạo audience trống trước khi nạp các shard hash.",
      value: 66,
    };
  }

  const totalHashes = job.totalHashes ?? job.receivedHashCount;
  const syncedHashes = Math.min(job.syncedHashCount, totalHashes);
  const ratio = totalHashes > 0 ? syncedHashes / totalHashes : 0;

  return {
    step: job.status === "completed" ? "Hoàn tất" : "Đang đồng bộ dữ liệu...",
    description:
      totalHashes > 0
        ? `Đã đồng bộ ${formatNumber(syncedHashes)} / ${formatNumber(totalHashes)} hash lên Meta.`
        : `Đã xử lý ${formatNumber(job.processedPartCount)} shard.`,
    value:
      job.status === "completed"
        ? 100
        : Math.min(98, 68 + Math.round(ratio * 28)),
  };
}

async function fetchAudiencesFromApi() {
  const response = await fetch("/api/audiences", {
    cache: "no-store",
  });
  const payload = await readJsonSafe<AudienceListResponse>(response);

  if (!response.ok) {
    throw new Error(payload.error || "Không thể đọc danh sách audiences.");
  }

  return payload.audiences ?? [];
}

async function readJsonSafe<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

function generateAudienceName() {
  const timestamp = new Date().toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
  return `Customer File Audience ${timestamp}`;
}

function formatAudienceSize(audience: Audience) {
  if (audience.sizeUpperBound === null) {
    return "Đang ước tính";
  }

  if (
    audience.sizeLowerBound !== null &&
    audience.sizeLowerBound > 0 &&
    audience.sizeLowerBound !== audience.sizeUpperBound
  ) {
    return `${formatNumber(audience.sizeLowerBound)} - ${formatNumber(
      audience.sizeUpperBound
    )}`;
  }

  return `≈ ${formatNumber(audience.sizeUpperBound)}`;
}

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

function dismissProgressLater(
  setProgress: React.Dispatch<React.SetStateAction<ProgressState | null>>,
  delay = 1400
) {
  window.setTimeout(() => {
    setProgress(null);
  }, delay);
}

function waitFor(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}
