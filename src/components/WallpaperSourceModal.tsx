/**
 * Wallpaper source picker for generic remote providers and the local library.
 * Click loads the original into ImageViewer before applying it as wallpaper.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useWallpaperProviderController,
  type WallpaperProviderBackgroundProgress,
  type WallpaperProviderBackgroundResult,
  type WallpaperProviderBackgroundState,
} from "@/hooks/useWallpaperProviderController";
import { useWallpaperItemPreview } from "@/hooks/useWallpaperItemPreview";
import { useWallpaperLibrary } from "@/hooks/useWallpaperLibrary";
import { useWallpaperCatalogMetadata } from "@/hooks/useWallpaperCatalogMetadata";
import { useWallpaperMediaActions } from "@/hooks/useWallpaperMediaActions";
import { useWallpaperSourceHistory } from "@/hooks/useWallpaperSourceHistory";
import { WallpaperProviderControls } from "./WallpaperProviderControls";
import { WallpaperSourceGallery } from "./WallpaperSourceGallery";
import { WallpaperSourceFooter } from "./WallpaperSourceFooter";
import { WallpaperSourceTabs } from "./WallpaperSourceTabs";
import { GlassModal } from "@/components/GlassModal";
import { Select } from "@/components/Select";
import { useImageViewerOptional } from "@/components/ImageViewerContext";
import * as api from "@/lib/api";
import { isDesktopHost } from "@/lib/api";
import {
  appendWallpaperGalleryItems,
  dedupeGalleryItems,
  fileFromAbsolutePath,
  parseWallpaperSourceError,
  type WallpaperGalleryItem,
  type WallpaperLibraryPurpose,
  type WallpaperSourceKind,
  type WallpaperSourceErrorCode,
} from "@/lib/wallpaperSource";
import {
  classifyWallpaperGalleryError,
  countGalleryByKind,
  filterGalleryItems,
  isWallpaperGallerySoftFail,
  resolveWallpaperGalleryEmptyState,
  wallpaperGalleryErrorTitleKey,
  wallpaperGalleryHasActiveFilters,
  wallpaperGalleryKindFilterLabelKey,
  WALLPAPER_GALLERY_KIND_FILTERS,
  type WallpaperGalleryKindFilter,
} from "@/lib/wallpaperGalleryPro";
import { WallpaperPrepareError } from "@/lib/themeSkin";
import {
  wallpaperRemoteProgressMessageKey,
  wallpaperRemoteUiError,
} from "@/lib/wallpaperRemoteSearch";
import {
  cancelRemoteWallpaperMediaRequests,
  ensureLocalWallpaperMedia,
} from "@/lib/wallpaperSourceMedia";
import type { MessageKey } from "@/i18n";

export type WallpaperSourceTab = WallpaperSourceKind;

export type WallpaperSourceModalProps = {
  open: boolean;
  onClose: () => void;
  initialTab?: WallpaperSourceTab;
  t: (
    key: MessageKey,
    vars?: Record<string, string | number | undefined | null>,
  ) => string;
  /** Apply prepared File via parent (prepareWallpaperFromFile + onWallpaper). */
  onPickFile: (file: File) => void | Promise<void>;
};

function errorMessage(
  t: WallpaperSourceModalProps["t"],
  code: WallpaperSourceErrorCode,
): string {
  const key = `settings.wallpaperSource.err.${code}` as MessageKey;
  const msg = t(key);
  return msg === key ? t("settings.wallpaperSource.err.generic") : msg;
}

export function WallpaperSourceModal({
  open,
  onClose,
  initialTab = "web",
  t,
  onPickFile,
}: WallpaperSourceModalProps) {
  const viewer = useImageViewerOptional();
  const [tab, setTab] = useState<WallpaperSourceTab>(initialTab);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<WallpaperGalleryItem[]>([]);
  const [galleryFilter, setGalleryFilter] = useState("");
  const [kindFilter, setKindFilter] =
    useState<WallpaperGalleryKindFilter>("all");
  const [libraryPurpose, setLibraryPurpose] =
    useState<WallpaperLibraryPurpose>("all");
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<WallpaperSourceErrorCode | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const sourceGenerationRef = useRef(0);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const openRef = useRef(open);
  openRef.current = open;
  const sourceHistory = useWallpaperSourceHistory();
  const pendingScrollRestore = useRef<{
    tab: WallpaperSourceTab;
    top: number;
  } | null>(null);

  const library = useWallpaperLibrary(
    open && tab === "library",
    galleryFilter,
    kindFilter,
    open,
    libraryPurpose,
  );
  const updateMediaItem = useCallback(
    (item: WallpaperGalleryItem) => {
      setItems((previous) =>
        previous.map((row) => (row.id === item.id ? item : row)),
      );
      sourceHistory.updateItem(item);
      library.updateItem(item);
      setError(null);
      setErrorCode(null);
    },
    [library.updateItem, sourceHistory.updateItem],
  );
  const reportMediaError = useCallback(() => {
    setErrorCode("generic");
    setError(t("settings.wallpaperSource.library.saveFailed"));
  }, [t]);
  const mediaActions = useWallpaperMediaActions({
    open,
    source: tab,
    onChanged: updateMediaItem,
    onError: reportMediaError,
  });
  useWallpaperCatalogMetadata(
    open && tab !== "library",
    items,
    setItems,
    reportMediaError,
  );

  const onProviderBackgroundProgress = useCallback(
    (event: WallpaperProviderBackgroundProgress) => {
      if (!openRef.current || tabRef.current === event.source) return;
      sourceHistory.update(event.source, (snapshot) => ({
        ...snapshot,
        query: event.query,
        items:
          snapshot.query === event.query
            ? appendWallpaperGalleryItems(snapshot.items, event.items)
            : appendWallpaperGalleryItems([], event.items),
        hasSearched: true,
        error: null,
        errorCode: null,
      }));
    },
    [sourceHistory.update],
  );
  const onProviderBackgroundResult = useCallback(
    (event: WallpaperProviderBackgroundResult) => {
      if (!openRef.current || tabRef.current === event.source) return;
      sourceHistory.update(event.source, (snapshot) => {
        if (event.error) {
          const code = parseWallpaperSourceError(event.error);
          return {
            ...snapshot,
            query: event.query,
            hasSearched: true,
            errorCode: code,
            error: errorMessage(t, code),
            providerContinuation:
              event.providerContinuation ?? snapshot.providerContinuation,
          };
        }
        if (!event.result) return snapshot;
        const code = wallpaperRemoteUiError(event.result) as
          | WallpaperSourceErrorCode
          | null;
        const incoming = dedupeGalleryItems(event.result.items);
        const sameQuery = snapshot.query === event.query;
        const nextItems =
          event.phase === "search" || !sameQuery
            ? incoming
            : appendWallpaperGalleryItems(snapshot.items, incoming);
        if (code && code !== "empty") {
          return {
            ...snapshot,
            query: event.query,
            items: event.phase === "search" ? [] : snapshot.items,
            hasSearched: true,
            errorCode: code,
            error: errorMessage(t, code),
            statusHint: null,
            providerContinuation:
              event.providerContinuation ?? snapshot.providerContinuation,
          };
        }
        const noMore = code === "empty" && event.phase === "loadMore" && !event.result.hasMore;
        return {
          ...snapshot,
          query: event.query,
          items: code === "empty" && event.phase === "search" ? [] : nextItems,
          hasSearched: true,
          errorCode: code === "empty" && !noMore ? "empty" : null,
          error: code === "empty" && !noMore ? errorMessage(t, "empty") : null,
          statusHint: noMore ? t("settings.wallpaperSource.noMore") : null,
          providerContinuation:
            event.providerContinuation ?? snapshot.providerContinuation,
        };
      });
    },
    [sourceHistory.update, t],
  );
  const onProviderBackgroundState = useCallback(
    (event: WallpaperProviderBackgroundState) => {
      if (!openRef.current || tabRef.current === event.source) return;
      sourceHistory.update(event.source, (snapshot) => ({
        ...snapshot,
        query: event.query,
        providerContinuation: event.state,
      }));
    },
    [sourceHistory.update],
  );
  const isProviderSourceVisible = useCallback(
    (source: "web" | "openverse" | "pexels") =>
      openRef.current && tabRef.current === source,
    [],
  );

  const providerSource = tab === "web" || tab === "openverse" || tab === "pexels"
    ? tab
    : null;
  const provider = useWallpaperProviderController({
    enabled: open && providerSource !== null,
    source: providerSource,
    query,
    items,
    t,
    setItems,
    setError,
    setErrorCode,
    setStatusHint,
    setHasSearched,
    setSelectedId,
    isSourceVisible: isProviderSourceVisible,
    onBackgroundProgress: onProviderBackgroundProgress,
    onBackgroundResult: onProviderBackgroundResult,
    onBackgroundState: onProviderBackgroundState,
  });
  const providerProgressKey = wallpaperRemoteProgressMessageKey(
    provider.stage,
    providerSource,
  );
  const busy =
    (providerSource !== null && provider.busy) ||
    (tab === "library" && (library.busy || library.loadingMore));
  const interactionLocked =
    (providerSource !== null && provider.busy && !provider.loadingMore) ||
    applying ||
    previewingId !== null;

  const close = useCallback(() => {
    sourceGenerationRef.current += 1;
    viewer.close?.();
    void provider.cancel();
    void cancelRemoteWallpaperMediaRequests().catch(() => {});
    onClose();
  }, [onClose, provider.cancel, viewer]);

  useEffect(() => {
    if (!open) void provider.cancel();
  }, [open, provider.cancel]);

  useEffect(() => {
    sourceGenerationRef.current += 1;
    sourceHistory.clear();
    pendingScrollRestore.current = null;
    setApplying(false);
    if (!open) return;
    setTab(initialTab);
    setQuery("");
    setItems([]);
    setGalleryFilter("");
    setKindFilter("all");
    setLibraryPurpose("all");
    setHasSearched(false);
    setSelectedId(null);
    setPreviewingId(null);
    setError(null);
    setErrorCode(null);
    setStatusHint(null);
  }, [initialTab, open, sourceHistory.clear]);

  useEffect(() => {
    if (!open || tab !== "library") return;
    setItems(library.items);
    setHasSearched(library.hasLoaded);
    setErrorCode(library.error);
    setError(library.error ? errorMessage(t, library.error) : null);
  }, [library.error, library.hasLoaded, library.items, open, t, tab]);

  const galleryItems = items;
  const kindCounts = useMemo(
    () => (tab === "library" ? library.kindCounts : countGalleryByKind(galleryItems)),
    [galleryItems, library.kindCounts, tab],
  );
  const visibleItems = useMemo(
    () =>
      tab === "library"
        ? galleryItems
        : filterGalleryItems(galleryItems, {
            query: galleryFilter,
            kind: kindFilter,
          }),
    [galleryFilter, galleryItems, kindFilter, tab],
  );

  useLayoutEffect(() => {
    const pending = pendingScrollRestore.current;
    const scroller = sourceHistory.scrollRef.current;
    if (!open || !pending || pending.tab !== tab || !scroller) return;
    if (tab === "library" && (!library.hasLoaded || items !== library.items)) {
      return;
    }
    if (busy && visibleItems.length === 0) return;
    scroller.scrollTop = pending.top;
    pendingScrollRestore.current = null;
  }, [
    busy,
    items,
    library.hasLoaded,
    library.items,
    open,
    sourceHistory.scrollRef,
    tab,
    visibleItems.length,
  ]);

  const filtersActive =
    wallpaperGalleryHasActiveFilters({
      query: galleryFilter,
      kind: kindFilter,
    }) || (tab === "library" && libraryPurpose !== "all");

  const emptyState = useMemo(() => {
    const base = resolveWallpaperGalleryEmptyState({
      loading: busy,
      query: galleryFilter,
      itemCount: visibleItems.length,
      error: errorCode ? { code: errorCode, message: error ?? errorCode } : error,
      totalCount: galleryItems.length,
      kindFilter,
      hasSearched,
    });
    if (!base) return null;
    if (tab === "library" && (base.kind === "idle" || base.kind === "empty")) {
      if (filtersActive) {
        return {
          ...base,
          kind: "filter_empty" as const,
          titleKey: "settings.wallpaperSource.empty.filterEmpty",
          hintKey: "settings.wallpaperSource.empty.filterEmptyHint",
          showClearFilters: false,
        };
      }
      return {
        ...base,
        titleKey:
          base.kind === "empty"
            ? "settings.wallpaperSource.empty.noResults"
            : "settings.wallpaperSource.emptyGallery",
        hintKey: "settings.wallpaperSource.empty.libraryIdleHint",
      };
    }
    return base;
  }, [
    busy,
    error,
    errorCode,
    filtersActive,
    galleryFilter,
    galleryItems.length,
    hasSearched,
    kindFilter,
    tab,
    visibleItems.length,
  ]);

  const galleryErrorKind = useMemo(() => {
    if (!errorCode && !error) return null;
    return classifyWallpaperGalleryError(
      errorCode ? { code: errorCode, message: error ?? errorCode } : error,
    );
  }, [error, errorCode]);

  const clearGalleryFilters = useCallback(() => {
    setGalleryFilter("");
    setKindFilter("all");
    setLibraryPurpose("all");
  }, []);

  const changeTab = useCallback(
    (nextTab: WallpaperSourceTab) => {
      if (nextTab === tab) return;
      sourceHistory.save(tab, {
        query,
        sort: "top",
        items: galleryItems,
        selectedId,
        galleryFilter,
        kindFilter,
        libraryPurpose,
        hasSearched: hasSearched || galleryItems.length > 0,
        statusHint,
        citeSummary: null,
        error,
        errorCode,
        xContinuation: null,
        providerContinuation: providerSource ? provider.capture() : null,
        scrollTop: sourceHistory.scrollRef.current?.scrollTop ?? 0,
      });
      const saved = sourceHistory.get(nextTab);
      if (nextTab === "web" || nextTab === "openverse" || nextTab === "pexels") {
        provider.restore(
          saved?.providerContinuation ?? {
            continuation: null,
            prefetched: null,
          },
        );
      }
      pendingScrollRestore.current = {
        tab: nextTab,
        top: saved?.scrollTop ?? 0,
      };
      sourceGenerationRef.current += 1;
      viewer.close?.();
      void cancelRemoteWallpaperMediaRequests().catch(() => {});
      setTab(nextTab);
      setQuery(saved?.query ?? "");
      setItems(saved?.items ?? []);
      setHasSearched(saved?.hasSearched ?? false);
      setSelectedId(saved?.selectedId ?? null);
      setError(saved?.error ?? null);
      setErrorCode(saved?.errorCode ?? null);
      setStatusHint(saved?.statusHint ?? null);
      setGalleryFilter(saved?.galleryFilter ?? "");
      setKindFilter(saved?.kindFilter ?? "all");
      setLibraryPurpose(saved?.libraryPurpose ?? "all");
    },
    [
      error,
      errorCode,
      galleryFilter,
      galleryItems,
      hasSearched,
      kindFilter,
      libraryPurpose,
      provider.capture,
      provider.restore,
      providerSource,
      query,
      selectedId,
      sourceHistory.get,
      sourceHistory.save,
      sourceHistory.scrollRef,
      statusHint,
      tab,
      viewer,
    ],
  );

  const selected = useMemo(
    () => visibleItems.find((item) => item.id === selectedId) ?? null,
    [selectedId, visibleItems],
  );

  const runProviderSearch = useCallback(() => {
    sourceGenerationRef.current += 1;
    viewer.close?.();
    void cancelRemoteWallpaperMediaRequests().catch(() => {});
    return provider.search();
  }, [provider.search, viewer]);

  const dropItem = useCallback((id: string) => {
    setItems((previous) => previous.filter((item) => item.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const [deleteConfirm, setDeleteConfirm] = useState<WallpaperGalleryItem | null>(null);
  const requestDeleteLibraryItem = useCallback(
    (item: WallpaperGalleryItem, event?: { preventDefault(): void; stopPropagation(): void }) => {
      event?.preventDefault();
      event?.stopPropagation();
      if (busy || applying || previewingId) return;
      setDeleteConfirm(item);
    },
    [applying, busy, previewingId],
  );

  const deleteLibraryItem = useCallback(
    async (item: WallpaperGalleryItem) => {
      const path = item.localPath?.trim();
      if (!path) return;
      if (!isDesktopHost()) {
        setErrorCode("generic");
        setError(t("settings.wallpaperSource.err.desktopOnly"));
        return;
      }
      setStatusHint(t("settings.wallpaperSource.deleting"));
      try {
        await api.wallpaperLibraryDelete(path);
        sourceHistory.invalidateLocalPath(path);
        library.remove(item.id);
        dropItem(item.id);
        setError(null);
        setErrorCode(null);
      } catch (cause) {
        const code = parseWallpaperSourceError(cause);
        setErrorCode(code);
        setError(
          code === "url_blocked"
            ? t("settings.wallpaperSource.err.deleteDenied")
            : t("settings.wallpaperSource.err.deleteFailed"),
        );
      } finally {
        setStatusHint(null);
      }
    },
    [dropItem, library.remove, sourceHistory.invalidateLocalPath, t],
  );

  const openItemPreview = useWallpaperItemPreview({
    interactionLocked,
    busyIds: mediaActions.busyIds,
    visibleItems,
    sourceGenerationRef,
    viewer,
    t,
    setItems,
    setSelectedId,
    setPreviewingId,
    setError,
    setErrorCode,
    setStatusHint,
  });

  const openExternalSource = useCallback((url: string) => {
    void api.openExternalUrl(url).catch(() => {});
  }, []);

  const applySelected = useCallback(async () => {
    if (!selected || mediaActions.busyIds.has(selected.id)) return;
    if (!isDesktopHost()) {
      setErrorCode("generic");
      setError(t("settings.wallpaperSource.err.desktopOnly"));
      return;
    }
    const sourceGeneration = sourceGenerationRef.current;
    setApplying(true);
    setError(null);
    setErrorCode(null);
    setStatusHint(t("settings.wallpaperSource.applying"));
    try {
      const local = await ensureLocalWallpaperMedia(selected);
      if (sourceGeneration !== sourceGenerationRef.current) return;
      const file = await fileFromAbsolutePath(local.path, {
        name: local.name,
        mime: local.mime,
      });
      if (sourceGeneration !== sourceGenerationRef.current) return;
      await onPickFile(file);
      if (sourceGeneration !== sourceGenerationRef.current) return;
      onClose();
    } catch (cause) {
      if (sourceGeneration !== sourceGenerationRef.current) return;
      if (cause instanceof WallpaperPrepareError) {
        const key = `settings.wallpaper.err.${cause.code}` as MessageKey;
        const message = t(key);
        setErrorCode("generic");
        setError(message === key ? t("settings.wallpaper.err.generic") : message);
        return;
      }
      const code = parseWallpaperSourceError(cause);
      setErrorCode(code);
      setError(errorMessage(t, code));
    } finally {
      if (sourceGeneration === sourceGenerationRef.current) {
        setApplying(false);
        setStatusHint(null);
      }
    }
  }, [mediaActions.busyIds, onClose, onPickFile, selected, t]);

  const closeModalLayer = useCallback(() => {
    if (viewer.isOpen?.()) {
      viewer.close?.();
      return;
    }
    close();
  }, [close, viewer]);

  const locked = busy || applying || previewingId !== null;
  const showGalleryFilters =
    tab === "library" || galleryItems.length > 0 || filtersActive;
  const softFailError =
    galleryErrorKind != null && isWallpaperGallerySoftFail(galleryErrorKind);
  const showEmptyBlock =
    emptyState != null &&
    (emptyState.kind === "loading" ||
      emptyState.kind === "idle" ||
      emptyState.kind === "filter_empty" ||
      !error);
  const canLoadMore = providerSource
    ? provider.canLoadMore
    : tab === "library"
      ? library.canLoadMore
      : false;
  const pageLoading =
    (providerSource !== null && provider.loadingMore) ||
    (tab === "library" && library.loadingMore);

  const loadNextPage = () => {
    if (providerSource) void provider.loadMore();
    else if (tab === "library") void library.loadMore();
  };

  return (
    <>
      <GlassModal
        open={open}
        onClose={closeModalLayer}
        title={t("settings.wallpaperSource.title")}
        size="lg"
        className="wallpaper-source-modal"
        wrapBody
        bodyClassName="wallpaper-source-modal__body"
        closeLabel={t("common.close")}
        footer={
          <WallpaperSourceFooter
            t={t}
            applying={applying}
            applyDisabled={
              selected === null ||
              interactionLocked ||
              (selected !== null && mediaActions.busyIds.has(selected.id))
            }
            onClose={close}
            onApply={() => void applySelected()}
          />
        }
      >
        <WallpaperSourceTabs
          t={t}
          value={tab}
          disabled={applying || previewingId !== null}
          panelId="wallpaper-source-panel"
          onChange={changeTab}
        />

        <div
          id="wallpaper-source-panel"
          className="wallpaper-source-panel"
          role="tabpanel"
          aria-labelledby={`wallpaper-source-tab-${tab}`}
        >
          {providerSource ? (
            <WallpaperProviderControls
              source={providerSource}
              query={query}
              busy={provider.busy}
              locked={locked}
              invalidKey={errorCode === "pexels_key_invalid"}
              t={t}
              setQuery={setQuery}
              search={runProviderSearch}
              cancel={provider.cancel}
              onSaved={() => {
                sourceGenerationRef.current += 1;
                viewer.close?.();
                void cancelRemoteWallpaperMediaRequests().catch(() => {});
                sourceHistory.clear("pexels");
                void provider.clear();
                setItems([]);
                setHasSearched(false);
                setSelectedId(null);
                setGalleryFilter("");
                setKindFilter("all");
                setError(null);
                setErrorCode(null);
                setStatusHint(null);
              }}
            />
          ) : (
            <div className="wallpaper-source-form">
              <div className="wallpaper-source-form__row">
                <button
                  type="button"
                  className="btn btn--solid"
                  disabled={locked}
                  onClick={() => library.refresh()}
                >
                  {busy
                    ? t("settings.wallpaperSource.libraryLoading")
                    : t("settings.wallpaperSource.libraryRefresh")}
                </button>
              </div>
            </div>
          )}

          {providerSource && provider.busy && providerProgressKey ? (
            <p className="wallpaper-source-status" role="status">
              {t(providerProgressKey)}
            </p>
          ) : null}
          {statusHint ? (
            <p className="wallpaper-source-status" role="status">
              {statusHint}
            </p>
          ) : null}

          {error ? (
            <div
              className={
                "wallpaper-source-error" +
                (softFailError ? " wallpaper-source-error--soft" : "")
              }
              role="alert"
            >
              {galleryErrorKind ? (
                <span
                  className={
                    "wallpaper-source-err-chip" +
                    (softFailError ? " wallpaper-source-err-chip--soft" : "")
                  }
                  data-kind={galleryErrorKind}
                >
                  {t(wallpaperGalleryErrorTitleKey(galleryErrorKind) as MessageKey)}
                </span>
              ) : null}
              <p>{error}</p>
            </div>
          ) : null}

          {showGalleryFilters ? (
            <div
              className={
                "wallpaper-source-filters" +
                (tab === "library" ? " wallpaper-library-toolbar" : "")
              }
            >
              {tab === "library" ? (
                <Select
                  className="wallpaper-library-toolbar__collection"
                  value={libraryPurpose}
                  options={(["all", "favorites", "generated", "cache"] as const).map(
                    (value) => ({
                      value,
                      label: t(`settings.wallpaperSource.library.${value}` as MessageKey),
                    }),
                  )}
                  onChange={(value) =>
                    setLibraryPurpose(value as WallpaperLibraryPurpose)
                  }
                  aria-label={t("settings.wallpaperSource.library.collection" as MessageKey)}
                  disabled={locked}
                />
              ) : null}
              <div
                className="wallpaper-source-chips"
                role="toolbar"
                aria-label={t("settings.wallpaperSource.kindLabel")}
              >
                {WALLPAPER_GALLERY_KIND_FILTERS.map((id) => {
                  const count = kindCounts[id];
                  if (id !== "all" && count === 0 && kindFilter !== id) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={
                        "wallpaper-source-chip" +
                        (kindFilter === id ? " is-active" : "")
                      }
                      aria-pressed={kindFilter === id}
                      disabled={locked && id !== kindFilter}
                      onClick={() => setKindFilter(id)}
                    >
                      <span>
                        {t(wallpaperGalleryKindFilterLabelKey(id) as MessageKey)}
                      </span>
                      <span className="wallpaper-source-chip-count">{count}</span>
                    </button>
                  );
                })}
              </div>
              <input
                type="search"
                className="wallpaper-source-form__input wallpaper-source-filters__query"
                value={galleryFilter}
                placeholder={t("settings.wallpaperSource.filterPlaceholder")}
                disabled={locked}
                onChange={(event) => setGalleryFilter(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-label={t("settings.wallpaperSource.filterPlaceholder")}
              />
              {filtersActive ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={clearGalleryFilters}
                  disabled={locked}
                >
                  {t("settings.wallpaperSource.clearFilters")}
                </button>
              ) : null}
            </div>
          ) : null}

          <WallpaperSourceGallery
            scrollRef={sourceHistory.scrollRef}
            favoriteBusyIds={mediaActions.busyIds}
            onToggleFavorite={(item) => void mediaActions.toggleFavorite(item)}
            t={t}
            tab={tab}
            busy={busy}
            locked={interactionLocked}
            visibleItems={visibleItems}
            selectedId={selectedId}
            previewingId={previewingId}
            showEmptyBlock={showEmptyBlock}
            emptyState={emptyState}
            clearGalleryFilters={clearGalleryFilters}
            openItemPreview={openItemPreview}
            dropItem={dropItem}
            openExternalSource={openExternalSource}
            requestDeleteLibraryItem={requestDeleteLibraryItem}
            canLoadMore={canLoadMore}
            loadingMore={pageLoading}
            onLoadMore={loadNextPage}
          />
        </div>
      </GlassModal>
      <GlassModal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title={t("wallpaper.library.deleteConfirmTitle")}
        size="sm"
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setDeleteConfirm(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid btn--danger"
              data-testid="wallpaper-library-delete-confirm"
              onClick={() => {
                const item = deleteConfirm;
                setDeleteConfirm(null);
                if (item) void deleteLibraryItem(item);
              }}
            >
              {t("wallpaper.library.deleteConfirmAction")}
            </button>
          </>
        }
      >
        <p className="rp-modal-copy">{t("wallpaper.library.deleteConfirm")}</p>
      </GlassModal>
    </>
  );
}
