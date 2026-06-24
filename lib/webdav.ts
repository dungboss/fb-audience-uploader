export const WEB_DAV_ROOT_PATH = "/";

const WEB_DAV_SUPPORTED_UPLOAD_MIME_TYPES = new Set([
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
]);

const WEB_DAV_SUPPORTED_UPLOAD_EXTENSIONS = new Set([".csv", ".txt"]);

export type WebDavDirectoryEntry = {
  path: string;
  name: string;
  isDirectory: boolean;
  mimeType: string | null;
  size: number | null;
  lastModified: string | null;
};

export type WebDavDirectoryResponse = {
  path: string;
  parentPath: string | null;
  folders: WebDavDirectoryEntry[];
  files: WebDavDirectoryEntry[];
};

export type WebDavBreadcrumbItem = {
  path: string;
  label: string;
};

export const normalizeWebDavPath = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === WEB_DAV_ROOT_PATH) {
    return WEB_DAV_ROOT_PATH;
  }

  const withoutOrigin = trimmed.replace(/^https?:\/\/[^/]+/i, "");
  const segments = withoutOrigin
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .filter((segment) => segment && segment !== "." && segment !== "..");

  return segments.length > 0 ? `${WEB_DAV_ROOT_PATH}${segments.join("/")}` : WEB_DAV_ROOT_PATH;
};

export const getWebDavParentPath = (value: string) => {
  const normalized = normalizeWebDavPath(value);

  if (normalized === WEB_DAV_ROOT_PATH) {
    return null;
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return WEB_DAV_ROOT_PATH;
  }

  return `${WEB_DAV_ROOT_PATH}${segments.slice(0, -1).join("/")}`;
};

export const buildWebDavBreadcrumbs = (value: string, rootLabel = "NAS") => {
  const normalized = normalizeWebDavPath(value);
  const segments = normalized.split("/").filter(Boolean);
  const breadcrumbs: WebDavBreadcrumbItem[] = [
    {
      path: WEB_DAV_ROOT_PATH,
      label: rootLabel,
    },
  ];

  let currentPath = "";

  for (const segment of segments) {
    currentPath += `/${segment}`;
    breadcrumbs.push({
      path: currentPath,
      label: segment,
    });
  }

  return breadcrumbs;
};

export const formatWebDavSize = (value: number | null) => {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let current = value / 1024;
  let index = 0;

  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }

  return `${current >= 10 ? current.toFixed(0) : current.toFixed(1)} ${units[index]}`;
};

export const formatWebDavDate = (value: string | null) => {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export const getWebDavEntryTypeLabel = (entry: WebDavDirectoryEntry) => {
  if (entry.isDirectory) {
    return "Folder";
  }

  const normalizedMimeType = entry.mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalizedMimeType === "text/csv" || normalizedMimeType === "application/vnd.ms-excel") {
    return "CSV";
  }

  if (normalizedMimeType === "text/plain") {
    return "TXT";
  }

  const extension = entry.name.includes(".") ? entry.name.split(".").at(-1) : "";
  if (extension) {
    return extension.toUpperCase();
  }

  return "File";
};

export const isSupportedWebDavUploadFile = (
  entry: Pick<WebDavDirectoryEntry, "name" | "mimeType" | "isDirectory">
) => {
  if (entry.isDirectory) {
    return false;
  }

  const normalizedMimeType = entry.mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (WEB_DAV_SUPPORTED_UPLOAD_MIME_TYPES.has(normalizedMimeType)) {
    return true;
  }

  const extension = entry.name.includes(".")
    ? `.${entry.name.split(".").at(-1)?.toLowerCase() ?? ""}`
    : "";

  return WEB_DAV_SUPPORTED_UPLOAD_EXTENSIONS.has(extension);
};
