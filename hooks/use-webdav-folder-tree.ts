"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  WEB_DAV_ROOT_PATH,
  buildWebDavBreadcrumbs,
  getWebDavParentPath,
  normalizeWebDavPath,
  type WebDavBreadcrumbItem,
  type WebDavDirectoryResponse,
} from "@/lib/webdav";

export type WebDavFolderTreeNodeState = {
  path: string;
  name: string;
  parentPath: string | null;
  childPaths: string[];
  isExpanded: boolean;
  isLoading: boolean;
  isLoaded: boolean;
};

export type WebDavFolderTreeRow = {
  path: string;
  name: string;
  parentPath: string | null;
  depth: number;
  childPaths: string[];
  isExpanded: boolean;
  isLoading: boolean;
  isLoaded: boolean;
  isActive: boolean;
  canExpand: boolean;
};

type UseWebDavFolderTreeOptions = {
  fetchDirectory: (path: string) => Promise<WebDavDirectoryResponse>;
  initialPath?: string;
  isOpen: boolean;
  rootLabel?: string;
};

type LoadDirectoryOptions = {
  force?: boolean;
};

type UseWebDavFolderTreeResult = {
  breadcrumbs: WebDavBreadcrumbItem[];
  currentDirectory: WebDavDirectoryResponse | null;
  currentPath: string;
  errorMessage: string | null;
  isCurrentDirectoryLoading: boolean;
  isInitializing: boolean;
  treeRows: WebDavFolderTreeRow[];
  refreshCurrentDirectory: () => Promise<void>;
  selectPath: (path: string) => void;
  toggleExpanded: (path: string) => void;
};

const createNodeState = (input: {
  path: string;
  name: string;
  parentPath: string | null;
  isExpanded?: boolean;
}): WebDavFolderTreeNodeState => ({
  path: input.path,
  name: input.name,
  parentPath: input.parentPath,
  childPaths: [],
  isExpanded: input.isExpanded ?? false,
  isLoading: false,
  isLoaded: false,
});

const getNameFromPath = (value: string, rootLabel: string) => {
  const normalized = normalizeWebDavPath(value);
  if (normalized === WEB_DAV_ROOT_PATH) {
    return rootLabel;
  }

  return normalized.split("/").filter(Boolean).at(-1) || rootLabel;
};

export const useWebDavFolderTree = ({
  fetchDirectory,
  initialPath = WEB_DAV_ROOT_PATH,
  isOpen,
  rootLabel = "NAS",
}: UseWebDavFolderTreeOptions): UseWebDavFolderTreeResult => {
  const [directoriesByPath, setDirectoriesByPath] = useState<
    Record<string, WebDavDirectoryResponse>
  >({});
  const [nodesByPath, setNodesByPath] = useState<
    Record<string, WebDavFolderTreeNodeState>
  >(() => ({
    [WEB_DAV_ROOT_PATH]: createNodeState({
      path: WEB_DAV_ROOT_PATH,
      name: rootLabel,
      parentPath: null,
      isExpanded: true,
    }),
  }));
  const [currentPath, setCurrentPath] = useState(() =>
    normalizeWebDavPath(initialPath)
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [loadingCurrentPath, setLoadingCurrentPath] = useState<string | null>(
    null
  );
  const directoriesRef = useRef(directoriesByPath);
  const nodesRef = useRef(nodesByPath);
  const currentPathRef = useRef(currentPath);
  const loadingPathsRef = useRef(new Set<string>());
  const wasOpenRef = useRef(false);

  useEffect(() => {
    directoriesRef.current = directoriesByPath;
  }, [directoriesByPath]);

  useEffect(() => {
    nodesRef.current = nodesByPath;
  }, [nodesByPath]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  const loadDirectory = useCallback(
    async (pathValue: string, options: LoadDirectoryOptions = {}) => {
      const normalizedPath = normalizeWebDavPath(pathValue);

      if (!options.force && directoriesRef.current[normalizedPath]) {
        return directoriesRef.current[normalizedPath];
      }

      if (loadingPathsRef.current.has(normalizedPath)) {
        return directoriesRef.current[normalizedPath] ?? null;
      }

      loadingPathsRef.current.add(normalizedPath);
      setErrorMessage(null);
      setLoadingCurrentPath(normalizedPath);
      setNodesByPath((previous) => {
        const existingNode =
          previous[normalizedPath] ??
          createNodeState({
            path: normalizedPath,
            name: getNameFromPath(normalizedPath, rootLabel),
            parentPath: getWebDavParentPath(normalizedPath),
          });

        return {
          ...previous,
          [normalizedPath]: {
            ...existingNode,
            isLoading: true,
          },
        };
      });

      try {
        const directory = await fetchDirectory(normalizedPath);

        setDirectoriesByPath((previous) => {
          const next = {
            ...previous,
            [normalizedPath]: directory,
          };
          directoriesRef.current = next;
          return next;
        });

        setNodesByPath((previous) => {
          const next = { ...previous };
          const existingNode =
            next[normalizedPath] ??
            createNodeState({
              path: normalizedPath,
              name: getNameFromPath(normalizedPath, rootLabel),
              parentPath: directory.parentPath ?? getWebDavParentPath(normalizedPath),
              isExpanded: normalizedPath === WEB_DAV_ROOT_PATH,
            });
          const childPaths = directory.folders.map((folder) =>
            normalizeWebDavPath(folder.path)
          );

          next[normalizedPath] = {
            ...existingNode,
            name:
              normalizedPath === WEB_DAV_ROOT_PATH
                ? rootLabel
                : existingNode.name,
            parentPath: directory.parentPath ?? existingNode.parentPath,
            childPaths,
            isExpanded: true,
            isLoaded: true,
            isLoading: false,
          };

          for (const folder of directory.folders) {
            const childPath = normalizeWebDavPath(folder.path);
            const existingChild = next[childPath];

            next[childPath] = {
              path: childPath,
              name: folder.name || getNameFromPath(childPath, rootLabel),
              parentPath: normalizedPath,
              childPaths: existingChild?.childPaths ?? [],
              isExpanded: existingChild?.isExpanded ?? false,
              isLoading: existingChild?.isLoading ?? false,
              isLoaded: existingChild?.isLoaded ?? false,
            };
          }

          nodesRef.current = next;
          return next;
        });

        return directory;
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : "Không thể đọc thư mục NAS.";
        setErrorMessage(message);

        setNodesByPath((previous) => {
          const existingNode = previous[normalizedPath];
          if (!existingNode) {
            return previous;
          }

          return {
            ...previous,
            [normalizedPath]: {
              ...existingNode,
              isLoading: false,
            },
          };
        });

        return null;
      } finally {
        loadingPathsRef.current.delete(normalizedPath);
        setLoadingCurrentPath((previous) =>
          previous === normalizedPath ? null : previous
        );
      }
    },
    [fetchDirectory, rootLabel]
  );

  const expandAncestors = useCallback(
    async (pathValue: string) => {
      const normalizedPath = normalizeWebDavPath(pathValue);
      const segments = normalizedPath.split("/").filter(Boolean);
      let current = WEB_DAV_ROOT_PATH;

      setNodesByPath((previous) => {
        const rootNode =
          previous[WEB_DAV_ROOT_PATH] ??
          createNodeState({
            path: WEB_DAV_ROOT_PATH,
            name: rootLabel,
            parentPath: null,
            isExpanded: true,
          });

        return {
          ...previous,
          [WEB_DAV_ROOT_PATH]: {
            ...rootNode,
            name: rootLabel,
            isExpanded: true,
          },
        };
      });

      await loadDirectory(WEB_DAV_ROOT_PATH);

      for (const segment of segments) {
        setNodesByPath((previous) => {
          const currentNode =
            previous[current] ??
            createNodeState({
              path: current,
              name: getNameFromPath(current, rootLabel),
              parentPath: getWebDavParentPath(current),
            });

          return {
            ...previous,
            [current]: {
              ...currentNode,
              isExpanded: true,
            },
          };
        });

        current = current === WEB_DAV_ROOT_PATH ? `/${segment}` : `${current}/${segment}`;
        await loadDirectory(current);
      }
    },
    [loadDirectory, rootLabel]
  );

  const selectPath = useCallback(
    (pathValue: string) => {
      const normalizedPath = normalizeWebDavPath(pathValue);
      currentPathRef.current = normalizedPath;
      setCurrentPath(normalizedPath);
      setErrorMessage(null);
      void expandAncestors(normalizedPath);
    },
    [expandAncestors]
  );

  const toggleExpanded = useCallback(
    (pathValue: string) => {
      const normalizedPath = normalizeWebDavPath(pathValue);
      const node = nodesRef.current[normalizedPath];
      const shouldExpand = !node?.isExpanded;

      setNodesByPath((previous) => {
        const existingNode =
          previous[normalizedPath] ??
          createNodeState({
            path: normalizedPath,
            name: getNameFromPath(normalizedPath, rootLabel),
            parentPath: getWebDavParentPath(normalizedPath),
          });

        return {
          ...previous,
          [normalizedPath]: {
            ...existingNode,
            isExpanded: shouldExpand,
          },
        };
      });

      if (shouldExpand) {
        void loadDirectory(normalizedPath);
      }
    },
    [loadDirectory, rootLabel]
  );

  const refreshCurrentDirectory = useCallback(async () => {
    await loadDirectory(currentPathRef.current, { force: true });
  }, [loadDirectory]);

  useEffect(() => {
    if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      setErrorMessage(null);
      setIsInitializing(false);
      return;
    }

    if (!isOpen || wasOpenRef.current) {
      return;
    }

    wasOpenRef.current = true;
    const targetPath = normalizeWebDavPath(initialPath);
    let isCancelled = false;
    currentPathRef.current = targetPath;
    setCurrentPath(targetPath);
    setErrorMessage(null);

    queueMicrotask(() => {
      if (isCancelled) {
        return;
      }

      setIsInitializing(true);
    });

    void (async () => {
      await expandAncestors(targetPath);
      if (!isCancelled) {
        setIsInitializing(false);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [expandAncestors, initialPath, isOpen]);

  const treeRows = useMemo(() => {
    const rows: WebDavFolderTreeRow[] = [];

    const visit = (path: string, depth: number) => {
      const node = nodesByPath[path];
      if (!node) {
        return;
      }

      if (path === WEB_DAV_ROOT_PATH) {
        for (const childPath of node.childPaths) {
          visit(childPath, 0);
        }
        return;
      }

      rows.push({
        path,
        name: node.name,
        parentPath: node.parentPath,
        depth,
        childPaths: node.childPaths,
        isExpanded: node.isExpanded,
        isLoading: node.isLoading,
        isLoaded: node.isLoaded,
        isActive: currentPath === path,
        canExpand: !node.isLoaded || node.isLoading || node.childPaths.length > 0,
      });

      if (!node.isExpanded) {
        return;
      }

      for (const childPath of node.childPaths) {
        visit(childPath, depth + 1);
      }
    };

    visit(WEB_DAV_ROOT_PATH, 0);
    return rows;
  }, [currentPath, nodesByPath]);

  const breadcrumbs = useMemo(
    () => buildWebDavBreadcrumbs(currentPath, rootLabel),
    [currentPath, rootLabel]
  );

  const currentDirectory = directoriesByPath[currentPath] ?? null;
  const isCurrentDirectoryLoading = loadingCurrentPath === currentPath;

  return {
    breadcrumbs,
    currentDirectory,
    currentPath,
    errorMessage,
    isCurrentDirectoryLoading,
    isInitializing,
    treeRows,
    refreshCurrentDirectory,
    selectPath,
    toggleExpanded,
  };
};
