import path from "node:path";

import {
  getWebDavParentPath,
  normalizeWebDavPath,
  type WebDavDirectoryEntry,
  type WebDavDirectoryResponse,
} from "@/lib/webdav";

const DEFAULT_WEBDAV_BASE_URL = "https://nas-api.batmedia.info/";

type WebDavConfig = {
  baseUrl: string;
  username?: string;
  password?: string;
};

let cachedConfig: WebDavConfig | null = null;

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const parseContentLength = (value: string | null) => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const decodeXmlEntities = (value: string) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");

const extractWebDavTagValue = (block: string, tagName: string) => {
  const pattern = new RegExp(
    `<[^:>]*:?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${tagName}>`,
    "i"
  );
  const match = block.match(pattern);
  return match ? decodeXmlEntities(match[1].trim()) : null;
};

const hasWebDavCollection = (block: string) =>
  /<[^:>]*:?collection\b[^>]*\/?>/i.test(block);

const getWebDavConfig = () => {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    baseUrl: process.env.WEBDAV_BASE_URL?.trim() || DEFAULT_WEBDAV_BASE_URL,
    username: process.env.WEBDAV_USERNAME?.trim() || undefined,
    password: process.env.WEBDAV_PASSWORD?.trim() || undefined,
  };

  return cachedConfig;
};

const encodeWebDavPath = (value: string) =>
  normalizeWebDavPath(value)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const decodeWebDavHrefPath = (href: string) => {
  const parsedUrl = isHttpUrl(href)
    ? new URL(href)
    : new URL(href, buildWebDavUrl("/", true));

  return normalizeWebDavPath(
    `/${parsedUrl.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join("/")}`
  );
};

const parseWebDavDirectoryEntries = (xmlText: string, requestedPath: string) => {
  const normalizedRequestedPath = normalizeWebDavPath(requestedPath);
  const responseBlocks =
    xmlText.match(/<[^:>]*:?response\b[\s\S]*?<\/[^:>]*:?response>/gi) ?? [];
  const entries: WebDavDirectoryEntry[] = [];

  for (const block of responseBlocks) {
    const href = extractWebDavTagValue(block, "href");
    if (!href) {
      continue;
    }

    const entryPath = decodeWebDavHrefPath(href);
    if (entryPath === normalizedRequestedPath) {
      continue;
    }

    const nameFromDisplayName = extractWebDavTagValue(block, "displayname");
    const entryName = (nameFromDisplayName || path.posix.basename(entryPath)).trim();
    const mimeType = extractWebDavTagValue(block, "getcontenttype");
    const sizeValue = extractWebDavTagValue(block, "getcontentlength");
    const lastModified = extractWebDavTagValue(block, "getlastmodified");

    entries.push({
      path: entryPath,
      name: entryName || path.posix.basename(entryPath) || entryPath,
      isDirectory: hasWebDavCollection(block),
      mimeType: mimeType && mimeType !== "application/octet-stream" ? mimeType : null,
      size: sizeValue && Number.isFinite(Number(sizeValue)) ? Number(sizeValue) : null,
      lastModified: lastModified || null,
    });
  }

  return entries.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }

    return left.path.localeCompare(right.path);
  });
};

export const buildWebDavUrl = (value: string, isDirectory = false) => {
  const baseUrl = getWebDavConfig().baseUrl;
  const encodedPath = encodeWebDavPath(value);
  const relativePath = encodedPath ? `${encodedPath}${isDirectory ? "/" : ""}` : "";

  return new URL(
    relativePath,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  ).toString();
};

export const getWebDavAuthHeaders = () => {
  const headers: Record<string, string> = {};
  const config = getWebDavConfig();

  if (config.username && config.password) {
    headers.Authorization = `Basic ${Buffer.from(
      `${config.username}:${config.password}`
    ).toString("base64")}`;
  }

  return headers;
};

export async function writeTextToWebDav(
  requestedPath: string,
  content: string
): Promise<void> {
  const normalizedPath = normalizeWebDavPath(requestedPath);

  await ensureWebDavParentDirectory(normalizedPath);

  const response = await fetch(buildWebDavUrl(normalizedPath, false), {
    method: "PUT",
    headers: {
      ...getWebDavAuthHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
    body: content,
  });

  if (!response.ok) {
    throw new Error(`WebDAV file write failed (${response.status})`);
  }
}

export async function fetchWebDavFileHead(
  requestedPath: string
): Promise<{ contentLength: number | null; contentType: string | null }> {
  const normalizedPath = normalizeWebDavPath(requestedPath);

  const response = await fetch(buildWebDavUrl(normalizedPath, false), {
    method: "HEAD",
    headers: {
      ...getWebDavAuthHeaders(),
    },
  });

  if (!response.ok) {
    throw new Error(`WebDAV HEAD failed (${response.status})`);
  }

  return {
    contentLength: parseContentLength(response.headers.get("content-length")),
    contentType: response.headers.get("content-type") ?? null,
  };
}

export async function fetchWebDavFileRange(
  requestedPath: string,
  start: number,
  end: number
): Promise<ArrayBuffer> {
  const normalizedPath = normalizeWebDavPath(requestedPath);

  const response = await fetch(buildWebDavUrl(normalizedPath, false), {
    method: "GET",
    headers: {
      ...getWebDavAuthHeaders(),
      Range: `bytes=${start}-${end}`,
    },
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(
      `WebDAV range request failed (${response.status})`
    );
  }

  return response.arrayBuffer();
}

export async function deleteWebDavFile(requestedPath: string): Promise<void> {
  const normalizedPath = normalizeWebDavPath(requestedPath);
  const response = await fetch(buildWebDavUrl(normalizedPath, false), {
    method: "DELETE",
    headers: {
      ...getWebDavAuthHeaders(),
    },
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`WebDAV file delete failed (${response.status})`);
  }
}

async function ensureWebDavParentDirectory(
  requestedPath: string
): Promise<void> {
  const normalizedPath = normalizeWebDavPath(requestedPath);
  const segments = normalizedPath.split("/").filter(Boolean);

  for (let index = 0; index < segments.length; index++) {
    const directoryPath = `/${segments.slice(0, index).join("/")}`;

    if (!directoryPath || directoryPath === "/") {
      continue;
    }

    const response = await fetch(buildWebDavUrl(directoryPath, true), {
      method: "MKCOL",
      headers: {
        ...getWebDavAuthHeaders(),
      },
    });

    if (!response.ok && response.status !== 405) {
      throw new Error(`WebDAV directory creation failed (${response.status})`);
    }
  }
}

export async function fetchWebDavDirectoryResponse(
  requestedPath: string
): Promise<WebDavDirectoryResponse> {
  const normalizedPath = normalizeWebDavPath(requestedPath);
  const response = await fetch(buildWebDavUrl(normalizedPath, true), {
    method: "PROPFIND",
    headers: {
      ...getWebDavAuthHeaders(),
      Depth: "1",
      Accept: "application/xml, text/xml;q=0.9, */*;q=0.8",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/><d:resourcetype/></d:prop></d:propfind>',
  });

  if (!response.ok) {
    throw new Error(`WebDAV directory listing failed (${response.status})`);
  }

  const entries = parseWebDavDirectoryEntries(await response.text(), normalizedPath);

  return {
    path: normalizedPath,
    parentPath: getWebDavParentPath(normalizedPath),
    folders: entries.filter((entry) => entry.isDirectory),
    files: entries.filter((entry) => !entry.isDirectory),
  };
}
