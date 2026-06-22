const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_FACEBOOK_API_VERSION = "v23.0";
const FACEBOOK_GRAPH_BASE_URL = "https://graph.facebook.com";

export type AudienceAvailability = "ready" | "populating";

export interface AudienceListItem {
  id: string;
  name: string;
  description: string;
  subtype: string;
  availability: AudienceAvailability;
  sizeUpperBound: number | null;
  sizeLowerBound: number | null;
  timeUpdated: string | null;
}

interface FacebookConfig {
  accessToken: string;
  adAccountId: string;
  apiVersion: string;
}

interface MetaAudience {
  id: string;
  name?: string;
  description?: string;
  subtype?: string;
  time_updated?: string;
  approximate_count_upper_bound?: number | string;
  approximate_count_lower_bound?: number | string;
  operation_status?: MetaStatus;
  delivery_status?: MetaStatus;
}

interface MetaAudienceListResponse {
  data?: MetaAudience[];
}

interface MetaAudienceCreateResponse {
  id: string;
}

interface MetaAudienceUploadResponse {
  num_received?: number;
  num_invalid_entries?: number;
  session_id?: string;
}

interface MetaDeleteResponse {
  success?: boolean;
}

interface MetaApiErrorPayload {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

type MetaStatus =
  | string
  | {
      code?: number | string;
      description?: string;
      status?: string;
    }
  | null
  | undefined;

export class FacebookApiError extends Error {
  readonly status: number;
  readonly details?: MetaApiErrorPayload;

  constructor(message: string, status = 500, details?: MetaApiErrorPayload) {
    super(message);
    this.name = "FacebookApiError";
    this.status = status;
    this.details = details;
  }
}

export function getClientSafeError(
  error: unknown,
  fallbackMessage: string
): { message: string; status: number; details?: MetaApiErrorPayload } {
  if (error instanceof FacebookApiError) {
    return {
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message || fallbackMessage,
      status: 500,
    };
  }

  return {
    message: fallbackMessage,
    status: 500,
  };
}

export function validateHashedEmails(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new FacebookApiError(
      "Danh sách email đã băm không hợp lệ hoặc đang trống.",
      400
    );
  }

  const normalizedHashes = input.map((value) => String(value).trim().toLowerCase());
  const invalidHashes = normalizedHashes.filter((hash) => !HASH_PATTERN.test(hash));

  if (invalidHashes.length > 0) {
    throw new FacebookApiError(
      "Server chỉ chấp nhận chuỗi SHA-256 hợp lệ. Không gửi email plaintext lên API.",
      400
    );
  }

  return Array.from(new Set(normalizedHashes));
}

export async function listAudiences(): Promise<AudienceListItem[]> {
  const { adAccountId } = getFacebookConfig();
  const response = await facebookRequest<MetaAudienceListResponse>(
    `${adAccountId}/customaudiences`,
    {
      method: "GET",
      query: {
        fields: [
          "id",
          "name",
          "description",
          "subtype",
          "time_updated",
          "approximate_count_upper_bound",
          "approximate_count_lower_bound",
          "operation_status",
          "delivery_status",
        ].join(","),
        limit: "200",
      },
    }
  );

  return (response.data ?? [])
    .map(mapAudience)
    .sort((left, right) => {
      const leftTime = left.timeUpdated ? new Date(left.timeUpdated).getTime() : 0;
      const rightTime = right.timeUpdated ? new Date(right.timeUpdated).getTime() : 0;
      return rightTime - leftTime;
    });
}

export async function createAudience(input: {
  name: string;
  description?: string;
  hashedEmails: unknown;
}) {
  const { adAccountId } = getFacebookConfig();
  const name = input.name.trim();
  const description = input.description?.trim() ?? "";
  const hashedEmails = validateHashedEmails(input.hashedEmails);

  if (!name) {
    throw new FacebookApiError("Tên đối tượng là bắt buộc.", 400);
  }

  const createFormData = new URLSearchParams();
  createFormData.set("name", name);
  createFormData.set("subtype", "CUSTOM");
  createFormData.set("customer_file_source", "USER_PROVIDED_ONLY");

  if (description) {
    createFormData.set("description", description);
  }

  const createdAudience = await facebookRequest<MetaAudienceCreateResponse>(
    `${adAccountId}/customaudiences`,
    {
      method: "POST",
      body: createFormData,
    }
  );

  const uploadResult = await uploadAudienceUsers(createdAudience.id, hashedEmails);

  return {
    audienceId: createdAudience.id,
    uploadedCount: uploadResult.num_received ?? hashedEmails.length,
    invalidEntryCount: uploadResult.num_invalid_entries ?? 0,
    sessionId: uploadResult.session_id ?? null,
  };
}

export async function addUsersToAudience(input: {
  audienceId: string;
  hashedEmails: unknown;
}) {
  const audienceId = input.audienceId.trim();
  const hashedEmails = validateHashedEmails(input.hashedEmails);

  if (!audienceId) {
    throw new FacebookApiError("Audience ID không hợp lệ.", 400);
  }

  const uploadResult = await uploadAudienceUsers(audienceId, hashedEmails);

  return {
    audienceId,
    uploadedCount: uploadResult.num_received ?? hashedEmails.length,
    invalidEntryCount: uploadResult.num_invalid_entries ?? 0,
    sessionId: uploadResult.session_id ?? null,
  };
}

export async function deleteAudience(audienceId: string) {
  const normalizedAudienceId = audienceId.trim();

  if (!normalizedAudienceId) {
    throw new FacebookApiError("Audience ID không hợp lệ.", 400);
  }

  const response = await facebookRequest<MetaDeleteResponse>(normalizedAudienceId, {
    method: "DELETE",
  });

  return {
    audienceId: normalizedAudienceId,
    deleted: Boolean(response.success ?? true),
  };
}

function getFacebookConfig(): FacebookConfig {
  const accessToken = pickFirstDefinedEnv([
    "FACEBOOK_ACCESS_TOKEN",
    "FB_ACCESS_TOKEN",
    "ACCESS_TOKEN",
  ]);
  const adAccountId = pickFirstDefinedEnv([
    "FACEBOOK_AD_ACCOUNT_ID",
    "FB_AD_ACCOUNT_ID",
    "AD_ACCOUNT_ID",
  ]);
  const apiVersion =
    pickFirstDefinedEnv(["FACEBOOK_API_VERSION", "META_API_VERSION"]) ??
    DEFAULT_FACEBOOK_API_VERSION;

  if (!accessToken) {
    throw new FacebookApiError(
      "Thiếu biến môi trường FACEBOOK_ACCESS_TOKEN trong .env.local.",
      500
    );
  }

  if (!adAccountId) {
    throw new FacebookApiError(
      "Thiếu biến môi trường FACEBOOK_AD_ACCOUNT_ID trong .env.local.",
      500
    );
  }

  return {
    accessToken,
    adAccountId: adAccountId.startsWith("act_")
      ? adAccountId
      : `act_${adAccountId}`,
    apiVersion,
  };
}

async function facebookRequest<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string> }
): Promise<T> {
  const { accessToken, apiVersion } = getFacebookConfig();
  const url = new URL(
    `${FACEBOOK_GRAPH_BASE_URL}/${apiVersion}/${path.replace(/^\/+/, "")}`
  );

  url.searchParams.set("access_token", accessToken);

  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  return parseFacebookResponse<T>(response);
}

async function parseFacebookResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? tryParseJson(text) : {};

  if (!response.ok || hasMetaError(payload)) {
    const errorPayload = hasMetaError(payload) ? payload.error : undefined;
    const fallbackMessage = `Facebook API trả về lỗi ${response.status}.`;

    throw new FacebookApiError(
      formatMetaErrorMessage(errorPayload) ?? errorPayload?.message ?? fallbackMessage,
      response.status,
      errorPayload
    );
  }

  return payload as T;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FacebookApiError("Facebook API trả về dữ liệu không phải JSON.", 502);
  }
}

function hasMetaError(
  payload: unknown
): payload is {
  error: MetaApiErrorPayload;
} {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object"
  );
}

function formatMetaErrorMessage(errorPayload?: MetaApiErrorPayload) {
  if (!errorPayload) {
    return undefined;
  }

  if (errorPayload.code === 190) {
    const expirationDetail = extractTokenExpirationDetail(errorPayload.message);
    return [
      "Facebook access token da het han.",
      expirationDetail,
      "Hay tao token moi, cap nhat FACEBOOK_ACCESS_TOKEN trong .env.local, sau do khoi dong lai server Next.js.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return undefined;
}

function extractTokenExpirationDetail(message?: string) {
  if (!message) {
    return undefined;
  }

  const expiredOnMatch = message.match(/Session has expired on (.+?)\./i);
  const currentTimeMatch = message.match(/The current time is (.+?)\./i);

  if (!expiredOnMatch && !currentTimeMatch) {
    return undefined;
  }

  const details = [
    expiredOnMatch
      ? `Token cu het han vao ${expiredOnMatch[1]}.`
      : undefined,
    currentTimeMatch
      ? `Thoi diem Meta kiem tra la ${currentTimeMatch[1]}.`
      : undefined,
  ].filter(Boolean);

  return details.join(" ");
}

async function uploadAudienceUsers(
  audienceId: string,
  hashedEmails: string[]
): Promise<MetaAudienceUploadResponse> {
  const matrixPayload = {
    schema: ["EMAIL_SHA256"],
    data: hashedEmails.map((hash) => [hash]),
  };

  try {
    return await postUsersPayload(audienceId, matrixPayload);
  } catch (error) {
    if (
      error instanceof FacebookApiError &&
      /schema|payload|data/i.test(error.message)
    ) {
      return postUsersPayload(audienceId, {
        schema: "EMAIL_SHA256",
        data: hashedEmails,
      });
    }

    throw error;
  }
}

async function postUsersPayload(
  audienceId: string,
  payload:
    | {
        schema: string[];
        data: string[][];
      }
    | {
        schema: string;
        data: string[];
      }
): Promise<MetaAudienceUploadResponse> {
  const uploadFormData = new URLSearchParams();
  uploadFormData.set("payload", JSON.stringify(payload));

  return facebookRequest<MetaAudienceUploadResponse>(`${audienceId}/users`, {
    method: "POST",
    body: uploadFormData,
  });
}

function mapAudience(audience: MetaAudience): AudienceListItem {
  return {
    id: audience.id,
    name: audience.name?.trim() || "Untitled audience",
    description: audience.description?.trim() ?? "",
    subtype: audience.subtype ?? "CUSTOM",
    availability: deriveAvailability(audience),
    sizeUpperBound: toNullableNumber(audience.approximate_count_upper_bound),
    sizeLowerBound: toNullableNumber(audience.approximate_count_lower_bound),
    timeUpdated: audience.time_updated ?? null,
  };
}

function deriveAvailability(audience: MetaAudience): AudienceAvailability {
  const statusText = [
    normalizeMetaStatus(audience.operation_status),
    normalizeMetaStatus(audience.delivery_status),
  ]
    .join(" ")
    .toLowerCase();

  if (/\bready\b|available|active/.test(statusText)) {
    return "ready";
  }

  if (/populating|processing|building|pending/.test(statusText)) {
    return "populating";
  }

  return (toNullableNumber(audience.approximate_count_upper_bound) ?? 0) > 0
    ? "ready"
    : "populating";
}

function normalizeMetaStatus(status: MetaStatus) {
  if (!status) {
    return "";
  }

  if (typeof status === "string") {
    return status;
  }

  return [status.code, status.status, status.description]
    .filter(Boolean)
    .join(" ");
}

function toNullableNumber(value: number | string | undefined) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsedNumber = Number(value);
  return Number.isFinite(parsedNumber) ? parsedNumber : null;
}

function pickFirstDefinedEnv(variableNames: string[]) {
  for (const variableName of variableNames) {
    const value = process.env[variableName]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}
