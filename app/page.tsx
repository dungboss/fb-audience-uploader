"use client";

import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { Accept } from "react-dropzone";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import { toast } from "sonner";
import {
  AlertCircle,
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
import { cn } from "@/lib/utils";

const DROPZONE_ACCEPT: Accept = {
  "text/csv": [".csv"],
  "text/plain": [".txt"],
  "application/vnd.ms-excel": [".csv"],
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXPIRING_SOON_DAYS = 150;
const numberFormatter = new Intl.NumberFormat("vi-VN");
const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
});

type AudienceAvailability = "ready" | "populating";

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

type UploadSnapshot = {
  fileName: string;
  validEmailCount: number;
  duplicateCount: number;
  hashedEmails: string[];
};

type ProgressState = {
  step: string;
  description: string;
  value: number;
};

type AudienceListResponse = {
  audiences?: Audience[];
  error?: string;
};

type AudienceMutationResponse = {
  audienceId: string;
  uploadedCount: number;
  invalidEntryCount: number;
  sessionId: string | null;
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
  const [createSnapshot, setCreateSnapshot] = useState<UploadSnapshot | null>(null);
  const [createProgress, setCreateProgress] = useState<ProgressState | null>(null);
  const [isPreparingCreateFile, setIsPreparingCreateFile] = useState(false);
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
  const [updateSnapshot, setUpdateSnapshot] = useState<UploadSnapshot | null>(null);
  const [updateProgress, setUpdateProgress] = useState<ProgressState | null>(null);
  const [isPreparingUpdateFile, setIsPreparingUpdateFile] = useState(false);
  const [isUpdateSubmitting, setIsUpdateSubmitting] = useState(false);

  const [deleteTargets, setDeleteTargets] = useState<Audience[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedIdSet = new Set(selectedIds);
  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase();
  const filteredAudiences = audiences.filter((audience) => {
    const matchesSearch =
      !normalizedSearchQuery ||
      audience.name.toLowerCase().includes(normalizedSearchQuery) ||
      audience.id.toLowerCase().includes(normalizedSearchQuery);

    return matchesSearch;
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

  async function handlePrepareCreateFile(file: File) {
    setIsPreparingCreateFile(true);
    setCreateProgress({
      step: "Đang đọc file...",
      description: `PapaParse đang quét ${file.name} trực tiếp trên trình duyệt.`,
      value: 8,
    });

    try {
      const snapshot = await prepareUploadSnapshot(file, setCreateProgress);
      setCreateSnapshot(snapshot);
      toast.success("File đã sẵn sàng để đồng bộ.", {
        description: `${formatNumber(snapshot.validEmailCount)} email hợp lệ đã được chuẩn hóa và băm SHA-256.`,
      });
      dismissProgressLater(setCreateProgress);
    } catch (error) {
      setCreateSnapshot(null);
      setCreateProgress(null);
      toast.error("Không thể xử lý file tạo audience.", {
        description: getErrorMessage(error, "Vui lòng kiểm tra lại file CSV/TXT."),
      });
    } finally {
      setIsPreparingCreateFile(false);
    }
  }

  async function handleCreateAudience() {
    if (!createSnapshot) {
      toast.error("Hãy chọn file dữ liệu trước khi đồng bộ.");
      return;
    }

    if (!audienceName.trim()) {
      toast.error("Tên đối tượng là bắt buộc.");
      return;
    }

    setIsCreateSubmitting(true);
    setCreateProgress({
      step: "Đang khởi tạo đối tượng trên Meta...",
      description: "Server đang tạo Custom Audience trống bằng Marketing API.",
      value: 72,
    });

    const syncStageTimer = window.setTimeout(() => {
      setCreateProgress((current) =>
        current
          ? {
              step: "Đang đồng bộ dữ liệu...",
              description:
                "Payload EMAIL_SHA256 đang được gửi đến endpoint /users của audience mới.",
              value: 88,
            }
          : current
      );
    }, 650);

    try {
      const response = await fetch("/api/audiences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: audienceName.trim(),
          description: description.trim(),
          hashedEmails: createSnapshot.hashedEmails,
        }),
      });

      const payload = await readJsonSafe<AudienceMutationResponse>(response);

      if (!response.ok) {
        throw new Error(payload.error || "Meta từ chối tạo Custom Audience.");
      }

      window.clearTimeout(syncStageTimer);
      setCreateProgress({
        step: "Đang làm mới dashboard...",
        description: "Audience đã tạo xong, đang tải lại danh sách mới nhất từ Meta.",
        value: 96,
      });
      await refreshAudiences({ silent: true });
      setCreateProgress({
        step: "Hoàn tất",
        description: `Audience ${payload.audienceId} đã nhận ${formatNumber(payload.uploadedCount)} email hash.`,
        value: 100,
      });
      toast.success("Tạo audience thành công.", {
        description: `Meta đã nhận ${formatNumber(payload.uploadedCount)} bản ghi đã băm.`,
      });

      setAudienceName(generateAudienceName());
      setDescription("");
      setCreateSnapshot(null);
      dismissProgressLater(setCreateProgress);
    } catch (error) {
      window.clearTimeout(syncStageTimer);
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
    setUpdateSnapshot(null);
    setUpdateProgress(null);
    setIsAddUsersDialogOpen(true);
  }

  async function handlePrepareUpdateFile(file: File) {
    setIsPreparingUpdateFile(true);
    setUpdateProgress({
      step: "Đang đọc file...",
      description: `Đang chuẩn bị dữ liệu bổ sung cho ${selectedAudience?.name ?? "audience đã chọn"}.`,
      value: 8,
    });

    try {
      const snapshot = await prepareUploadSnapshot(file, setUpdateProgress);
      setUpdateSnapshot(snapshot);
      toast.success("File đã sẵn sàng để nạp thêm.", {
        description: `${formatNumber(snapshot.validEmailCount)} email hash sẽ được thêm vào audience hiện tại.`,
      });
      dismissProgressLater(setUpdateProgress);
    } catch (error) {
      setUpdateSnapshot(null);
      setUpdateProgress(null);
      toast.error("Không thể xử lý file bổ sung.", {
        description: getErrorMessage(error, "Vui lòng kiểm tra lại nội dung file."),
      });
    } finally {
      setIsPreparingUpdateFile(false);
    }
  }

  async function handleAppendUsers() {
    if (!selectedAudience) {
      toast.error("Chưa có audience nào được chọn.");
      return;
    }

    if (!updateSnapshot) {
      toast.error("Hãy chọn file CSV/TXT trước khi nạp thêm dữ liệu.");
      return;
    }

    setIsUpdateSubmitting(true);
    setUpdateProgress({
      step: "Đang đồng bộ dữ liệu...",
      description: `Server đang gửi EMAIL_SHA256 vào audience ${selectedAudience.id}.`,
      value: 84,
    });

    try {
      const response = await fetch(`/api/audiences/${selectedAudience.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hashedEmails: updateSnapshot.hashedEmails,
        }),
      });

      const payload = await readJsonSafe<AudienceMutationResponse>(response);

      if (!response.ok) {
        throw new Error(payload.error || "Meta từ chối thêm dữ liệu vào audience.");
      }

      setUpdateProgress({
        step: "Đang làm mới dashboard...",
        description: "Audience đã nhận thêm dữ liệu, đang tải lại trạng thái mới nhất.",
        value: 96,
      });
      await refreshAudiences({ silent: true });
      setUpdateProgress({
        step: "Hoàn tất",
        description: `${formatNumber(payload.uploadedCount)} email hash đã được nạp thêm vào audience.`,
        value: 100,
      });
      toast.success("Bổ sung dữ liệu thành công.", {
        description: `${formatNumber(payload.uploadedCount)} bản ghi đã được gửi lên Meta.`,
      });
      dismissProgressLater(setUpdateProgress);
      setUpdateSnapshot(null);
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
        <div>
          <main className="space-y-6">
            <Card className="rounded-[28px] border-white/60 bg-white/85 shadow-lg shadow-slate-950/5 backdrop-blur">
              <CardHeader>
                <CardTitle>Tạo mới và đồng bộ Custom Audience</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Tên đối tượng
                      </label>
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
                        placeholder="Mô tả nguồn dữ liệu, giai đoạn chiến dịch hoặc logic làm mới audience."
                      />
                    </div>
                  </div>

                  <UploadDropzone
                    disabled={isPreparingCreateFile || isCreateSubmitting}
                    title="Kéo thả file CSV/TXT để chuẩn bị dữ liệu"
                    helperText="Tìm email hợp lệ, chuẩn hóa và băm SHA-256 ngay trong trình duyệt."
                    snapshot={createSnapshot}
                    onFileSelected={handlePrepareCreateFile}
                  />
                </div>

                <ProgressPanel progress={createProgress} />

                <div className="flex justify-end rounded-2xl border border-dashed bg-muted/20 p-4">
                  <Button
                    type="button"
                    onClick={handleCreateAudience}
                    disabled={
                      !createSnapshot ||
                      isPreparingCreateFile ||
                      isCreateSubmitting
                    }
                    size="lg"
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
                        <TableHead>Lần chỉnh sửa cuối</TableHead>
                        <TableHead className="text-right">Hành động</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isBootstrapping ? (
                        <TableRow>
                          <TableCell colSpan={7} className="py-10">
                            <div className="flex items-center justify-center gap-3 text-muted-foreground">
                              <Loader2 className="size-4 animate-spin" />
                              Đang tải danh sách Custom Audiences...
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : filteredAudiences.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="py-12">
                            <div className="flex flex-col items-center gap-3 text-center">
                              <div className="flex size-12 items-center justify-center rounded-2xl border bg-muted/40">
                                <Users className="size-5 text-muted-foreground" />
                              </div>
                              <div className="space-y-1">
                                <p className="font-medium">
                                  Không có audience nào khớp bộ lọc hiện tại.
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  Hãy tạo audience mới hoặc điều chỉnh tìm kiếm /
                                  bộ lọc bên trái.
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
                                  {isAudienceExpiringSoon(audience.timeUpdated) ? (
                                    <Badge variant="warning">Sắp hết hạn</Badge>
                                  ) : null}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-72 whitespace-normal text-sm text-muted-foreground">
                              {audience.description || "Chưa có mô tả"}
                            </TableCell>
                            <TableCell>
                              <AvailabilityBadge
                                availability={audience.availability}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              {formatAudienceSize(audience)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDateTime(audience.timeUpdated)}
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
            setUpdateSnapshot(null);
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
              compact
              disabled={isPreparingUpdateFile || isUpdateSubmitting}
              title="Tải file CSV/TXT mới để nạp thêm vào audience"
              helperText="Dữ liệu sẽ được chuẩn hóa và băm SHA-256 trước khi gửi vào /users."
              snapshot={updateSnapshot}
              onFileSelected={handlePrepareUpdateFile}
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
                setUpdateSnapshot(null);
                setUpdateProgress(null);
              }}
              disabled={isUpdateSubmitting}
            >
              Hủy
            </Button>
            <Button
              type="button"
              onClick={handleAppendUsers}
              disabled={!updateSnapshot || isPreparingUpdateFile || isUpdateSubmitting}
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
  helperText,
  snapshot,
  compact = false,
  onFileSelected,
}: {
  disabled?: boolean;
  title: string;
  helperText: string;
  snapshot: UploadSnapshot | null;
  compact?: boolean;
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

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          "group rounded-[24px] border border-dashed px-5 py-6 transition-colors",
          compact ? "min-h-52" : "min-h-60",
          disabled
            ? "cursor-not-allowed border-border bg-muted/20 opacity-70"
            : "cursor-pointer border-border bg-muted/15 hover:border-sky-400 hover:bg-sky-500/[0.03]",
          isDragActive && "border-sky-500 bg-sky-500/5"
        )}
      >
        <input {...getInputProps()} />
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <div
            className={cn(
              "flex size-14 items-center justify-center rounded-2xl border bg-background shadow-sm",
              isDragActive
                ? "border-sky-500 text-sky-600"
                : "border-border text-muted-foreground"
            )}
          >
            <Upload className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {isDragActive ? "Thả file vào đây để bắt đầu xử lý" : title}
            </p>
            <p className="text-sm text-muted-foreground">{helperText}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Hỗ trợ `.csv` và `.txt`. Plaintext email không rời khỏi trình duyệt.
          </p>
        </div>
      </div>

      {snapshot ? (
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{snapshot.fileName}</Badge>
          <Badge variant="secondary">
            {formatNumber(snapshot.validEmailCount)} email hash
          </Badge>
          {snapshot.duplicateCount > 0 ? (
            <Badge variant="warning">
              Đã loại {formatNumber(snapshot.duplicateCount)} trùng lặp
            </Badge>
          ) : null}
        </div>
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

async function prepareUploadSnapshot(
  file: File,
  setProgress: React.Dispatch<React.SetStateAction<ProgressState | null>>
): Promise<UploadSnapshot> {
  setProgress({
    step: "Đang đọc file...",
    description: "PapaParse đang đọc dữ liệu tại client và tách từng ô nội dung.",
    value: 14,
  });

  const parseResult = await new Promise<Papa.ParseResult<string[]>>(
    (resolve, reject) => {
      Papa.parse<string[]>(file, {
        skipEmptyLines: "greedy",
        worker: true,
        complete: resolve,
        error: reject,
      });
    }
  );

  setProgress({
    step: "Đang đọc file...",
    description: "Đang lọc email hợp lệ, chuyển về chữ thường và loại khoảng trắng thừa.",
    value: 28,
  });

  const normalizedEmails = extractNormalizedEmails(parseResult.data);

  if (normalizedEmails.length === 0) {
    throw new Error("Không tìm thấy email hợp lệ trong file vừa tải lên.");
  }

  const uniqueEmails = Array.from(new Set(normalizedEmails));
  const duplicateCount = normalizedEmails.length - uniqueEmails.length;

  setProgress({
    step: "Đang mã hóa dữ liệu...",
    description: `Đang băm ${formatNumber(uniqueEmails.length)} email bằng Web Crypto API.`,
    value: 34,
  });

  const hashedEmails = await hashEmailList(uniqueEmails, (completed, total) => {
    const ratio = total === 0 ? 1 : completed / total;
    setProgress({
      step: "Đang mã hóa dữ liệu...",
      description: `Đã băm ${formatNumber(completed)} / ${formatNumber(total)} email hợp lệ.`,
      value: 34 + Math.round(ratio * 32),
    });
  });

  setProgress({
    step: "Sẵn sàng đồng bộ",
    description: `${formatNumber(uniqueEmails.length)} email hash đã sẵn sàng để gửi lên server.`,
    value: 100,
  });

  return {
    fileName: file.name,
    validEmailCount: uniqueEmails.length,
    duplicateCount,
    hashedEmails,
  };
}

function extractNormalizedEmails(rows: string[][]) {
  const emails: string[] = [];

  for (const row of rows) {
    for (const cell of row) {
      const chunks = cell
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
    await new Promise((resolve) => window.setTimeout(resolve, 0));
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

function isAudienceExpiringSoon(timeUpdated: string | null) {
  if (!timeUpdated) {
    return false;
  }

  const updatedAt = new Date(timeUpdated);

  if (Number.isNaN(updatedAt.getTime())) {
    return false;
  }

  const elapsedDays =
    (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);

  return elapsedDays >= EXPIRING_SOON_DAYS;
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

function formatDateTime(value: string | null) {
  if (!value) {
    return "Chưa có dữ liệu";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Chưa có dữ liệu";
  }

  return dateTimeFormatter.format(date);
}

function formatNumber(value: number) {
  return numberFormatter.format(value);
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
