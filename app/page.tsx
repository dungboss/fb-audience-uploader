"use client";

import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Download,
  FolderOpen,
  KeyRound,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  StopCircle,
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

const numberFormatter = new Intl.NumberFormat("vi-VN");

// How often to refresh the job list while any job is queued/processing.
const JOB_POLL_INTERVAL_MS = 2000;

// Remembers the picked ad account across reloads (per browser).
const AD_ACCOUNT_STORAGE_KEY = "fb-audience-uploader:selected-ad-account";
// Remembers the picked access token id ("" = the .env fallback token).
const TOKEN_STORAGE_KEY = "fb-audience-uploader:selected-token";

type AudienceAvailability = "ready" | "populating";
type AudienceJobKind = "create" | "append";
type AudienceJobStatus =
  | "draft"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

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

type AdAccount = {
  id: string; // act_<id>
  accountId: string;
  name: string;
  accountStatus: number | null;
  currency: string | null;
};

type AdAccountListResponse = {
  adAccounts?: AdAccount[];
  defaultAdAccountId?: string | null;
  error?: string;
};

type FbToken = {
  id: string;
  label: string;
  appId: string | null;
  createdAt: string;
  lastValidatedAt: string | null;
};

type TokenListResponse = {
  tokens?: FbToken[];
  hasEnvToken?: boolean;
  error?: string;
};

// One option in the token picker. The empty-id entry represents the .env token.
type TokenOption = { id: string; label: string };

type NasFileSelection = {
  fileName: string;
  nasFilePath: string;
  fileSize: number | null;
};

type NasBrowseTarget = "create" | "update";

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
  nasFilePath: string;
  fileName: string;
  audienceId: string | null;
  syncedHashCount: number;
  syncedLines: number;
  processedLines: number;
  processedBytes: number;
  totalLines: number | null;
  totalBytes: number | null;
  lastSessionId: string | null;
  errorMessage: string | null;
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

type DeleteAudienceResponse = {
  audienceId: string;
  deleted: boolean;
  error?: string;
};

export default function Home() {
  const [audienceName, setAudienceName] = useState(() => generateAudienceName());
  const [description, setDescription] = useState("");
  const [createFile, setCreateFile] = useState<NasFileSelection | null>(null);
  const [createProgress, setCreateProgress] = useState<ProgressState | null>(null);
  const [isCreateSubmitting, setIsCreateSubmitting] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const [tokens, setTokens] = useState<FbToken[]>([]);
  const [hasEnvToken, setHasEnvToken] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState("");
  const [tokensReady, setTokensReady] = useState(false);
  const [isLoadingTokens, setIsLoadingTokens] = useState(true);
  const [isAddTokenDialogOpen, setIsAddTokenDialogOpen] = useState(false);
  const [newTokenLabel, setNewTokenLabel] = useState("");
  const [newTokenValue, setNewTokenValue] = useState("");
  const [newTokenAppId, setNewTokenAppId] = useState("");
  const [newTokenAppSecret, setNewTokenAppSecret] = useState("");
  const [isAddingToken, setIsAddingToken] = useState(false);
  const [deletingTokenId, setDeletingTokenId] = useState<string | null>(null);

  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [selectedAdAccountId, setSelectedAdAccountId] = useState("");
  const [isLoadingAdAccounts, setIsLoadingAdAccounts] = useState(true);

  // Token picker options: the .env fallback (empty id) plus every stored token.
  const tokenOptions: TokenOption[] = [
    ...(hasEnvToken ? [{ id: "", label: "Token mặc định (.env)" }] : []),
    ...tokens.map((token) => ({
      id: token.id,
      label: token.appId ? `${token.label} · App ${token.appId}` : token.label,
    })),
  ];
  const hasAnyTokenOption = tokenOptions.length > 0;

  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [selectedAudience, setSelectedAudience] = useState<Audience | null>(null);
  const [isAddUsersDialogOpen, setIsAddUsersDialogOpen] = useState(false);
  const [updateFile, setUpdateFile] = useState<NasFileSelection | null>(null);
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

  const [recentJobs, setRecentJobs] = useState<AudienceUploadJob[]>([]);
  const [isLoadingRecentJobs, setIsLoadingRecentJobs] = useState(false);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const activeJobs = recentJobs.filter(
    (j) => j.status === "queued" || j.status === "processing"
  );
  const activeJobCount = activeJobs.length;

  // Jobs whose terminal status we've already surfaced (avoid re-toasting on poll).
  const announcedDoneRef = useRef<Set<string>>(new Set());

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

  // --- Cancel a running job ---
  async function cancelJob(jobId: string) {
    try {
      const response = await fetch(`/api/upload-jobs/${jobId}`, {
        method: "DELETE",
      });
      const payload = await readJsonSafe<AudienceJobResponse>(response);

      if (!response.ok) {
        throw new Error(payload.error || "Không thể huỷ job upload.");
      }
    } catch (error) {
      throw error;
    }
  }

  // --- Bootstrap step 1: load access tokens, pick the active one ---
  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      setIsLoadingTokens(true);

      try {
        const { tokens: nextTokens, hasEnvToken: envToken } =
          await fetchTokensFromApi();

        if (isCancelled) {
          return;
        }

        setTokens(nextTokens);
        setHasEnvToken(envToken);

        const optionIds = [
          ...(envToken ? [""] : []),
          ...nextTokens.map((token) => token.id),
        ];
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(TOKEN_STORAGE_KEY)
            : null;
        const pick =
          stored !== null && optionIds.includes(stored)
            ? stored
            : envToken
              ? ""
              : nextTokens[0]?.id ?? "";

        setSelectedTokenId(pick);
        setTokensReady(true);

        if (optionIds.length === 0) {
          // No token at all — guide the user to add one.
          setIsBootstrapping(false);
          setServerError(
            "Chưa có access token nào. Hãy bấm “Thêm token” để kết nối Meta."
          );
        }
      } catch (error) {
        if (isCancelled) {
          return;
        }

        const message = getErrorMessage(
          error,
          "Không thể tải danh sách access token."
        );
        setServerError(message);
        setIsBootstrapping(false);
        toast.error("Không tải được token.", { description: message });
      } finally {
        if (!isCancelled) {
          setIsLoadingTokens(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  // --- Bootstrap step 2: load ad accounts for the active token ---
  // Depends on tokensReady too so it runs even when the picked token id is ""
  // (the .env fallback), which wouldn't change selectedTokenId from its initial.
  useEffect(() => {
    if (!tokensReady || !hasAnyTokenOption) {
      return;
    }

    let isCancelled = false;

    void (async () => {
      setIsLoadingAdAccounts(true);

      try {
        const { adAccounts: accounts, defaultAdAccountId } =
          await fetchAdAccountsFromApi(selectedTokenId);

        if (isCancelled) {
          return;
        }

        setAdAccounts(accounts);

        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(AD_ACCOUNT_STORAGE_KEY)
            : null;
        const pick =
          (stored && accounts.some((a) => a.id === stored) ? stored : null) ??
          (defaultAdAccountId &&
          accounts.some((a) => a.id === defaultAdAccountId)
            ? defaultAdAccountId
            : null) ??
          accounts[0]?.id ??
          "";

        setSelectedAdAccountId(pick);

        if (!pick) {
          setIsBootstrapping(false);
          setServerError(
            "Token này không truy cập được ad account nào. Kiểm tra quyền ads_management / ads_read."
          );
        } else {
          setServerError(null);
        }
      } catch (error) {
        if (isCancelled) {
          return;
        }

        const message = getErrorMessage(
          error,
          "Không thể tải danh sách ad account từ Meta."
        );
        setServerError(message);
        setIsBootstrapping(false);
        toast.error("Không tải được ad account.", { description: message });
      } finally {
        if (!isCancelled) {
          setIsLoadingAdAccounts(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTokenId, tokensReady]);

  // --- Bootstrap step 3: load audiences for the active token + ad account ---
  useEffect(() => {
    if (!selectedAdAccountId) {
      return;
    }

    let isCancelled = false;

    void (async () => {
      setIsBootstrapping(true);

      try {
        const nextAudiences = await fetchAudiencesFromApi(
          selectedAdAccountId,
          selectedTokenId
        );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAdAccountId, selectedTokenId]);

  function handleSelectToken(tokenId: string) {
    if (tokenId === selectedTokenId) {
      return;
    }

    setSelectedTokenId(tokenId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, tokenId);
    }
  }

  async function handleAddToken() {
    const token = newTokenValue.trim();

    if (!token) {
      toast.error("Hãy dán access token.");
      return;
    }

    setIsAddingToken(true);

    try {
      const response = await fetch("/api/facebook/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newTokenLabel.trim(),
          token,
          appId: newTokenAppId.trim(),
          appSecret: newTokenAppSecret.trim(),
        }),
      });
      const payload = await readJsonSafe<{
        token?: FbToken;
        adAccountCount?: number;
        error?: string;
      }>(response);

      if (!response.ok || !payload.token) {
        throw new Error(payload.error || "Không thể thêm access token.");
      }

      const { tokens: nextTokens, hasEnvToken: envToken } =
        await fetchTokensFromApi();
      setTokens(nextTokens);
      setHasEnvToken(envToken);
      handleSelectToken(payload.token.id);

      toast.success("Đã thêm access token.", {
        description: `${payload.token.label} · ${formatNumber(
          payload.adAccountCount ?? 0
        )} ad account khả dụng.`,
      });

      setNewTokenLabel("");
      setNewTokenValue("");
      setNewTokenAppId("");
      setNewTokenAppSecret("");
      setIsAddTokenDialogOpen(false);
    } catch (error) {
      toast.error("Thêm token thất bại.", {
        description: getErrorMessage(error, "Không thể thêm access token."),
      });
    } finally {
      setIsAddingToken(false);
    }
  }

  async function handleDeleteToken(tokenId: string) {
    if (!tokenId) {
      return;
    }

    setDeletingTokenId(tokenId);

    try {
      const response = await fetch(`/api/facebook/tokens/${tokenId}`, {
        method: "DELETE",
      });
      const payload = await readJsonSafe<{ deleted?: boolean; error?: string }>(
        response
      );

      if (!response.ok || !payload.deleted) {
        throw new Error(payload.error || "Không thể xóa access token.");
      }

      const { tokens: nextTokens, hasEnvToken: envToken } =
        await fetchTokensFromApi();
      setTokens(nextTokens);
      setHasEnvToken(envToken);

      if (selectedTokenId === tokenId) {
        handleSelectToken(envToken ? "" : nextTokens[0]?.id ?? "");
      }

      toast.success("Đã xóa access token.");
    } catch (error) {
      toast.error("Xóa token thất bại.", {
        description: getErrorMessage(error, "Không thể xóa access token."),
      });
    } finally {
      setDeletingTokenId(null);
    }
  }

  function handleSelectAdAccount(adAccountId: string) {
    if (!adAccountId || adAccountId === selectedAdAccountId) {
      return;
    }

    setSelectedAdAccountId(adAccountId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AD_ACCOUNT_STORAGE_KEY, adAccountId);
    }
  }

  // --- Mount: load recent jobs once ---
  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      setIsLoadingRecentJobs(true);
      try {
        const jobs = await fetchRecentJobsFromApi();
        if (isCancelled) return;
        // Seed already-finished jobs so they don't toast on first load.
        for (const job of jobs) {
          if (job.status !== "queued" && job.status !== "processing") {
            announcedDoneRef.current.add(job.id);
          }
        }
        setRecentJobs(jobs);
      } catch {
        // recent jobs is non-critical
      } finally {
        if (!isCancelled) setIsLoadingRecentJobs(false);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  // --- Poll job statuses while any job is queued/processing ---
  // This is the single source of truth for live job updates: it lets the user
  // close the dialog right after queueing a file and still watch every job
  // (đang đợi → đang up → xong) progress in the list as the worker drains them.
  useEffect(() => {
    if (activeJobCount === 0) return;
    let isCancelled = false;

    const interval = setInterval(() => {
      void (async () => {
        try {
          const jobs = await fetchRecentJobsFromApi();
          if (isCancelled) return;
          setRecentJobs(jobs);

          for (const job of jobs) {
            if (
              job.status === "completed" ||
              job.status === "failed" ||
              job.status === "cancelled"
            ) {
              if (announcedDoneRef.current.has(job.id)) continue;
              announcedDoneRef.current.add(job.id);

              if (job.status === "completed") {
                toast.success("Đồng bộ xong.", {
                  description: `${job.name || job.fileName}: ${formatNumber(job.syncedHashCount)} hash đã lên Meta.`,
                });
                void refreshAudiences({ silent: true });
              } else if (job.status === "failed") {
                toast.error("Job upload thất bại.", {
                  description: job.errorMessage || job.name || job.fileName,
                });
              }
            }
          }
        } catch {
          // ignore transient poll errors
        }
      })();
    }, JOB_POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [activeJobCount]);

  async function refreshRecentJobs() {
    try {
      setRecentJobs(await fetchRecentJobsFromApi());
    } catch {
      // non-critical
    }
  }

  // --- Cancel a job from the recent jobs list ---
  async function handleCancelJob(jobId: string) {
    setCancellingJobId(jobId);
    try {
      await cancelJob(jobId);
      announcedDoneRef.current.add(jobId);
      toast.success("Đã huỷ job upload.");
      void refreshRecentJobs();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Không thể huỷ job upload."
      );
    } finally {
      setCancellingJobId(null);
    }
  }

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

  function openNasBrowser(target: NasBrowseTarget) {
    setNasBrowseTarget(target);
    setIsNasBrowserOpen(true);
  }

  function closeNasBrowser() {
    setIsNasBrowserOpen(false);
    setNasBrowseTarget(null);
  }

  function handleNasFileSelected(selection: NasFileSelection) {
    if (!nasBrowseTarget) {
      throw new Error("Chưa xác định nơi nhận file từ NAS.");
    }

    if (nasBrowseTarget === "create") {
      setCreateFile(selection);
      setCreateProgress(null);
      setAudienceName(selection.fileName.replace(/\.[^/.]+$/, ""));
      return;
    }

    setUpdateFile(selection);
    setUpdateProgress(null);
  }

  function openCreateDialog() {
    setAudienceName(generateAudienceName());
    setDescription("");
    setCreateFile(null);
    setCreateProgress(null);
    setIsCreateDialogOpen(true);
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

    if (!selectedAdAccountId) {
      toast.error("Hãy chọn tài khoản quảng cáo trước khi tạo audience.");
      return;
    }

    const fileName = createFile.fileName;
    setIsCreateSubmitting(true);

    try {
      const job = await createAudienceJob({
        kind: "create",
        name: audienceName.trim(),
        description: description.trim(),
        nasFilePath: createFile.nasFilePath,
        fileSize: createFile.fileSize,
      });

      // Queued — worker drains jobs one at a time. Close the dialog so the user
      // can immediately queue another file; the list tracks progress live.
      announcedDoneRef.current.delete(job.id);
      await refreshRecentJobs();

      toast.success("Đã thêm vào hàng đợi upload.", {
        description: `${fileName} sẽ được xử lý lần lượt. Bạn có thể thêm file khác.`,
      });

      setAudienceName(generateAudienceName());
      setDescription("");
      setCreateFile(null);
      setCreateProgress(null);
      setIsCreateDialogOpen(false);
    } catch (error) {
      const errMsg = getErrorMessage(error, "Không thể tạo job upload.");
      toast.error("Tạo job thất bại.", { description: errMsg });
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
      toast.error("Hãy chọn file trên NAS trước khi nạp thêm dữ liệu.");
      return;
    }

    const audienceLabel = selectedAudience.name;
    setIsUpdateSubmitting(true);

    try {
      const job = await createAudienceJob({
        kind: "append",
        audienceId: selectedAudience.id,
        nasFilePath: updateFile.nasFilePath,
        fileSize: updateFile.fileSize,
      });

      announcedDoneRef.current.delete(job.id);
      await refreshRecentJobs();

      toast.success("Đã thêm vào hàng đợi upload.", {
        description: `Nạp thêm vào ${audienceLabel} sẽ chạy lần lượt. Bạn có thể thêm file khác.`,
      });

      setUpdateFile(null);
      setUpdateProgress(null);
      setIsAddUsersDialogOpen(false);
      setSelectedAudience(null);
    } catch (error) {
      const errMsg = getErrorMessage(error, "Không thể tạo job nạp thêm.");
      toast.error("Tạo job thất bại.", { description: errMsg });
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
        const deleteQuery = selectedTokenId
          ? `?tokenId=${encodeURIComponent(selectedTokenId)}`
          : "";
        const response = await fetch(
          `/api/audiences/${audience.id}${deleteQuery}`,
          {
            method: "DELETE",
          }
        );
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

  // ... remaining helper functions follow the same pattern as original code ...

  function formatNumber(value: number) {
    return numberFormatter.format(value);
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatAudienceSize(audience: Audience) {
    if (audience.sizeLowerBound === null && audience.sizeUpperBound === null) {
      return "Chưa xác định";
    }
    const lower = audience.sizeLowerBound ?? 0;
    const upper = audience.sizeUpperBound ?? lower;
    if (lower === upper) return formatNumber(lower);
    return `${formatNumber(lower)} – ${formatNumber(upper)}`;
  }

  function generateAudienceName() {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `Audience ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  // Quote a CSV field only when it contains a comma, quote, or newline.
  function toCsvField(value: string) {
    const v = value ?? "";
    return /[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  }

  // Export the on-screen audience columns (name, id, description, status, size)
  // to a UTF-8 CSV the browser downloads — no backend round-trip needed.
  function exportAudiencesToCsv(list: Audience[]) {
    if (list.length === 0) {
      toast.error("Không có audience nào để xuất.");
      return;
    }

    const headers = ["Tên đối tượng", "ID", "Mô tả", "Trạng thái", "Quy mô ước tính"];
    const rows = list.map((audience) => [
      audience.name,
      audience.id,
      audience.description || "",
      audience.availability === "ready" ? "Sẵn sàng" : "Đang cập nhật",
      formatAudienceSize(audience),
    ]);

    const csv = [headers, ...rows]
      .map((cols) => cols.map(toCsvField).join(","))
      .join("\r\n");

    // Prepend BOM so Excel reads UTF-8 (Vietnamese) correctly.
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fileName = `audiences-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.csv`;

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    toast.success(`Đã xuất ${formatNumber(list.length)} audience ra CSV.`);
  }

  function getErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error) return error.message;
    return fallback;
  }

  async function readJsonSafe<T>(response: Response) {
    try {
      return (await response.json()) as T;
    } catch {
      return {} as T;
    }
  }

  async function fetchTokensFromApi() {
    const response = await fetch("/api/facebook/tokens", { cache: "no-store" });
    const payload = await readJsonSafe<TokenListResponse>(response);
    if (!response.ok) throw new Error(payload.error || "API error");
    return {
      tokens: payload.tokens ?? [],
      hasEnvToken: Boolean(payload.hasEnvToken),
    };
  }

  async function fetchAdAccountsFromApi(tokenId: string = selectedTokenId) {
    const query = tokenId ? `?tokenId=${encodeURIComponent(tokenId)}` : "";
    const response = await fetch(`/api/facebook/ad-accounts${query}`, {
      cache: "no-store",
    });
    const payload = await readJsonSafe<AdAccountListResponse>(response);
    if (!response.ok) throw new Error(payload.error || "API error");
    return {
      adAccounts: payload.adAccounts ?? [],
      defaultAdAccountId: payload.defaultAdAccountId ?? null,
    };
  }

  async function fetchAudiencesFromApi(
    accountId: string = selectedAdAccountId,
    tokenId: string = selectedTokenId
  ) {
    if (!accountId) return [];
    const params = new URLSearchParams({ adAccountId: accountId });
    if (tokenId) params.set("tokenId", tokenId);
    const response = await fetch(`/api/audiences?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = await readJsonSafe<AudienceListResponse>(response);
    if (!response.ok) throw new Error(payload.error || "API error");
    return payload.audiences ?? [];
  }

  async function fetchRecentJobsFromApi() {
    // no-store: polling must always hit the network, not a cached response.
    const response = await fetch("/api/upload-jobs", { cache: "no-store" });
    const payload = await readJsonSafe<{ jobs?: AudienceUploadJob[] }>(response);
    if (!response.ok) throw new Error((payload as { error?: string }).error || "API error");
    return payload.jobs ?? [];
  }

  async function createAudienceJob(input: {
    kind: AudienceJobKind;
    name?: string;
    description?: string;
    audienceId?: string;
    nasFilePath: string;
    fileSize?: number | null;
  }) {
    const response = await fetch("/api/upload-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Snapshot the picked ad account + token onto the job so the worker
      // creates the audience under the right account using the right token
      // (append jobs ignore the ad account harmlessly).
      body: JSON.stringify({
        ...input,
        adAccountId: selectedAdAccountId,
        tokenId: selectedTokenId,
      }),
    });
    const payload = await readJsonSafe<AudienceJobResponse>(response);
    if (!response.ok || !payload.job) throw new Error(payload.error || "Không thể tạo job.");
    return payload.job;
  }

  function JobStatusBadge({ status }: { status: AudienceJobStatus }) {
    const map: Record<AudienceJobStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "warning" }> = {
      draft: { label: "Nháp", variant: "secondary" },
      queued: { label: "Đang chờ", variant: "outline" },
      processing: { label: "Đang xử lý", variant: "default" },
      completed: { label: "Hoàn tất", variant: "default" },
      failed: { label: "Thất bại", variant: "destructive" },
      cancelled: { label: "Đã huỷ", variant: "secondary" },
    };
    const info = map[status] ?? { label: status, variant: "outline" as const };
    return <Badge variant={info.variant}>{info.label}</Badge>;
  }

  function AvailabilityBadge({ availability }: { availability: AudienceAvailability }) {
    return (
      <Badge variant={availability === "ready" ? "default" : "secondary"}>
        {availability === "ready" ? "Sẵn sàng" : "Đang cập nhật"}
      </Badge>
    );
  }

  // --- Render helper components ---
  function ProgressPanel({ progress }: { progress: ProgressState | null }) {
    if (!progress) return null;
    return (
      <div className="rounded-2xl border bg-muted/30 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{progress.step}</p>
            <p className="mt-1 text-xs text-muted-foreground">{progress.description}</p>
          </div>
          <span className="text-sm font-medium tabular-nums">{progress.value}%</span>
        </div>
        <Progress value={progress.value} className="mt-3 h-2" />
      </div>
    );
  }

  function NasUploadSelector({
    disabled,
    title,
    selection,
    onBrowseNas,
  }: {
    disabled: boolean;
    title: string;
    selection: NasFileSelection | null;
    onBrowseNas: () => void;
  }) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">{title}</p>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={onBrowseNas}
        >
          <FolderOpen className="size-4" />
          {selection ? "Đổi file khác" : "Duyệt NAS"}
        </Button>
        {selection ? (
          <div className="rounded-xl border bg-muted/20 p-3 text-sm">
            <p className="font-medium truncate">{selection.fileName}</p>
            <p className="mt-1 text-xs text-muted-foreground truncate">{selection.nasFilePath}</p>
            {selection.fileSize ? (
              <p className="mt-1 text-xs text-muted-foreground">{formatFileSize(selection.fileSize)}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50/40 p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Facebook Audience Uploader
            </h1>
            <p className="mt-2 text-muted-foreground">
              Đồng bộ Custom Audience từ file trên NAS lên Meta Ads.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="token-select"
                className="text-xs font-medium text-muted-foreground"
              >
                Access token
              </label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select
                    id="token-select"
                    value={selectedTokenId}
                    onChange={(event) => handleSelectToken(event.target.value)}
                    disabled={isLoadingTokens || !hasAnyTokenOption}
                    className="h-10 w-full min-w-56 appearance-none rounded-xl border border-input bg-white px-3 pr-9 text-sm font-medium shadow-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {isLoadingTokens ? (
                      <option value="">Đang tải token...</option>
                    ) : !hasAnyTokenOption ? (
                      <option value="">Chưa có token</option>
                    ) : (
                      tokenOptions.map((option) => (
                        <option key={option.id || "__env__"} value={option.id}>
                          {option.label}
                        </option>
                      ))
                    )}
                  </select>
                  {isLoadingTokens ? (
                    <Loader2 className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  ) : (
                    <KeyRound className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Thêm access token"
                  onClick={() => setIsAddTokenDialogOpen(true)}
                >
                  <Plus className="size-4" />
                </Button>
                {selectedTokenId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Xóa token đang chọn"
                    onClick={() => handleDeleteToken(selectedTokenId)}
                    disabled={deletingTokenId === selectedTokenId}
                  >
                    {deletingTokenId === selectedTokenId ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="ad-account-select"
                className="text-xs font-medium text-muted-foreground"
              >
                Tài khoản quảng cáo
              </label>
              <div className="relative">
                <select
                  id="ad-account-select"
                  value={selectedAdAccountId}
                  onChange={(event) => handleSelectAdAccount(event.target.value)}
                  disabled={isLoadingAdAccounts || adAccounts.length === 0}
                  className="h-10 w-full min-w-72 appearance-none rounded-xl border border-input bg-white px-3 pr-9 text-sm font-medium shadow-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {isLoadingAdAccounts ? (
                    <option value="">Đang tải tài khoản...</option>
                  ) : adAccounts.length === 0 ? (
                    <option value="">Không có tài khoản khả dụng</option>
                  ) : (
                    adAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.id})
                        {account.currency ? ` · ${account.currency}` : ""}
                      </option>
                    ))
                  )}
                </select>
                {isLoadingAdAccounts ? (
                  <Loader2 className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                ) : (
                  <Users className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="space-y-8">
          {activeJobs.length > 0 || isLoadingRecentJobs ? (
            <Card className="rounded-[28px] border-white/60 bg-white/85 shadow-lg shadow-slate-950/5 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg">Job đang chạy / gần đây</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingRecentJobs && activeJobs.length === 0 ? (
                  <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Đang tải...
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/35">
                          <TableHead>Tên / File</TableHead>
                          <TableHead>Loại</TableHead>
                          <TableHead>Trạng thái</TableHead>
                          <TableHead>Tiến độ</TableHead>
                          <TableHead>Thời gian</TableHead>
                          <TableHead className="text-right">Theo dõi</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeJobs.map((job) => (
                          <TableRow key={job.id}>
                            <TableCell>
                              <div className="space-y-1">
                                <p className="text-sm font-medium">
                                  {job.name || job.fileName}
                                </p>
                                <p className="max-w-80 truncate text-xs text-muted-foreground">
                                  {job.nasFilePath}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {job.kind === "create" ? "Tạo mới" : "Nạp thêm"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <JobStatusBadge status={job.status} />
                            </TableCell>
                            <TableCell>
                              {job.status === "processing" ? (
                                <div className="max-w-32">
                                  <Progress
                                    value={
                                      job.totalBytes && job.totalBytes > 0
                                        ? Math.round(
                                            (job.processedBytes / job.totalBytes) * 100
                                          )
                                        : 0
                                    }
                                    className="h-1.5"
                                  />
                                  <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                                    {job.processedBytes > 0
                                      ? formatFileSize(job.processedBytes)
                                      : "..."}
                                    {job.totalBytes
                                      ? ` / ${formatFileSize(job.totalBytes)}`
                                      : ""}
                                  </span>
                                </div>
                              ) : null}
                              {job.status === "queued" ? (
                                <span className="text-xs text-muted-foreground">
                                  Đang chờ...
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(job.createdAt).toLocaleString("vi-VN")}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleCancelJob(job.id)}
                                  disabled={cancellingJobId === job.id}
                                >
                                  {cancellingJobId === job.id ? (
                                    <>
                                      <Loader2 className="size-3.5 animate-spin" />
                                      Đang huỷ
                                    </>
                                  ) : (
                                    <>
                                      <StopCircle className="size-3.5" />
                                      Huỷ
                                    </>
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card className="rounded-[28px] border-white/60 bg-white/85 shadow-lg shadow-slate-950/5 backdrop-blur">
            <CardHeader className="gap-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  Danh sách Custom Audiences
                  {!isBootstrapping ? (
                    <Badge variant="secondary">
                      {formatNumber(filteredAudiences.length)}
                    </Badge>
                  ) : null}
                </CardTitle>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative w-full sm:min-w-72">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className="pl-9"
                      placeholder="Tìm kiếm theo tên hoặc ID audience"
                    />
                  </div>
                  <div className="flex items-center gap-2">
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
                    <Button type="button" onClick={openCreateDialog}>
                      <Plus className="size-4" />
                      Tạo audience
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        exportAudiencesToCsv(
                          selectedAudiences.length > 0
                            ? selectedAudiences
                            : filteredAudiences
                        )
                      }
                      disabled={filteredAudiences.length === 0}
                    >
                      <Download className="size-4" />
                      {selectedIds.length > 0
                        ? `Xuất CSV (${selectedIds.length})`
                        : "Xuất CSV"}
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
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          if (isCreateSubmitting) {
            return;
          }

          setIsCreateDialogOpen(open);
          if (!open) {
            setCreateFile(null);
            setCreateProgress(null);
          }
        }}
        disablePointerDismissal={isCreateSubmitting}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="size-5" />
              Tạo Custom Audience mới
            </DialogTitle>
            <DialogDescription>
              Tạo audience mới và đồng bộ EMAIL_SHA256 từ file CSV/TXT trên NAS lên Meta.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-5">
            <div className="space-y-3">
              <label className="text-sm font-medium">Tên audience</label>
              <Input
                value={audienceName}
                onChange={(e) => setAudienceName(e.target.value)}
                placeholder="Nhập tên audience..."
                disabled={isCreateSubmitting}
              />
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium">Mô tả</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Mô tả ngắn gọn (không bắt buộc)..."
                disabled={isCreateSubmitting}
                rows={2}
              />
            </div>
            <NasUploadSelector
              disabled={isCreateSubmitting}
              title="Chọn file dữ liệu CSV/TXT từ NAS"
              selection={createFile}
              onBrowseNas={() => openNasBrowser("create")}
            />
            <ProgressPanel progress={createProgress} />
          </div>

          <DialogFooter>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCreateDialogOpen(false);
                  setCreateFile(null);
                  setCreateProgress(null);
                }}
                disabled={isCreateSubmitting}
              >
                Đóng
              </Button>
              <Button
                type="button"
                onClick={handleCreateAudience}
                disabled={!createFile || isCreateSubmitting}
              >
                {isCreateSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Đang thêm...
                  </>
                ) : (
                  <>
                    <Upload className="size-4" />
                    Đưa vào hàng đợi
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                : "Chọn file CSV/TXT trên NAS để nạp thêm EMAIL_SHA256 vào audience hiện tại."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-5">
            <NasUploadSelector
              disabled={isUpdateSubmitting}
              title="Chọn file CSV/TXT từ NAS"
              selection={updateFile}
              onBrowseNas={() => openNasBrowser("update")}
            />

            <ProgressPanel progress={updateProgress} />
          </div>

          <DialogFooter>
            <div className="flex items-center gap-3">
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
                Đóng
              </Button>
              <Button
                type="button"
                onClick={handleAppendUsers}
                disabled={!updateFile || isUpdateSubmitting}
              >
                {isUpdateSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Đang thêm...
                  </>
                ) : (
                  <>
                    <Upload className="size-4" />
                    Đưa vào hàng đợi
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAddTokenDialogOpen}
        onOpenChange={(open) => {
          if (isAddingToken) {
            return;
          }
          setIsAddTokenDialogOpen(open);
          if (!open) {
            setNewTokenLabel("");
            setNewTokenValue("");
            setNewTokenAppId("");
            setNewTokenAppSecret("");
          }
        }}
        disablePointerDismissal={isAddingToken}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5" />
              Thêm Facebook access token
            </DialogTitle>
            <DialogDescription>
              Token (kèm App ID / App Secret) được kiểm tra với Meta rồi mã hóa
              lưu trên server, không lưu trong trình duyệt. Cần quyền
              ads_management hoặc ads_read.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-5">
            <div className="space-y-3">
              <label className="text-sm font-medium">Nhãn (tùy chọn)</label>
              <Input
                value={newTokenLabel}
                onChange={(e) => setNewTokenLabel(e.target.value)}
                placeholder="VD: BM Công ty A"
                disabled={isAddingToken}
              />
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium">Access token</label>
              <Textarea
                value={newTokenValue}
                onChange={(e) => setNewTokenValue(e.target.value)}
                placeholder="Dán access token vào đây..."
                disabled={isAddingToken}
                rows={4}
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-3">
                <label className="text-sm font-medium">App ID (tùy chọn)</label>
                <Input
                  value={newTokenAppId}
                  onChange={(e) => setNewTokenAppId(e.target.value)}
                  placeholder="VD: 1234567890"
                  disabled={isAddingToken}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-3">
                <label className="text-sm font-medium">
                  App Secret (tùy chọn)
                </label>
                <Input
                  type="password"
                  value={newTokenAppSecret}
                  onChange={(e) => setNewTokenAppSecret(e.target.value)}
                  placeholder="Để bật appsecret_proof"
                  disabled={isAddingToken}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              App Secret dùng để tạo appsecret_proof — bắt buộc nếu app bật
              “Require app secret”. Bỏ trống nếu app không yêu cầu.
            </p>
          </div>

          <DialogFooter>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAddTokenDialogOpen(false);
                  setNewTokenLabel("");
                  setNewTokenValue("");
                  setNewTokenAppId("");
                  setNewTokenAppSecret("");
                }}
                disabled={isAddingToken}
              >
                Đóng
              </Button>
              <Button
                type="button"
                onClick={handleAddToken}
                disabled={!newTokenValue.trim() || isAddingToken}
              >
                {isAddingToken ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Đang kiểm tra...
                  </>
                ) : (
                  <>
                    <Plus className="size-4" />
                    Thêm token
                  </>
                )}
              </Button>
            </div>
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
                <div key={audience.id} className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{audience.name}</span>
                  <span className="text-xs text-muted-foreground">{audience.id}</span>
                </div>
              ))}
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Không, giữ lại</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteAudiences}
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
                  Xóa vĩnh viễn
                </>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}