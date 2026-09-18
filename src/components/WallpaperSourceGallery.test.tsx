/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";
import { WallpaperSourceGallery } from "./WallpaperSourceGallery";

const ensureMediaEndpoint = vi.hoisted(() => vi.fn(async () => null));
const resolveImageSrcSync = vi.hoisted(() =>
  vi.fn<(path: string) => string | null>(
    (path) => `http://127.0.0.1/media/${encodeURIComponent(path)}`,
  ),
);

vi.mock("@/lib/imageSrc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/imageSrc")>()),
  ensureMediaEndpoint,
  resolveImageSrcSync,
}));

vi.mock("@/lib/api/wallpaper", () => ({
  wallpaperLibraryFindById: vi.fn(),
}));
vi.mock("@/lib/nativeWebviewCover", () => ({
  acquireNativeWebviewCover: () => () => {},
}));
vi.mock("./WallpaperProviderThumbnail", () => ({
  WallpaperProviderThumbnail: () => (
    <span data-testid="remote-provider-thumbnail" />
  ),
}));

const t = ((key: string) => key) as never;
const item: WallpaperGalleryItem = {
  id: "saved-artwork",
  source: "library",
  kind: "image",
  thumbUrl: "https://example.test/thumb.jpg",
  fullUrl: "https://example.test/full.jpg",
  localPath: "C:/wallpapers/saved-artwork.jpg",
  textPreview: "Saved artwork",
  metadata: {
    id: "media-saved",
    source: "library",
    sourceUrl: null,
    license: null,
    licenseUrl: null,
    title: "Saved artwork",
    width: 1280,
    height: 720,
    prompt: "A quiet mountain lake",
    generation: null,
    parentId: null,
    favorite: false,
    purpose: "generated",
    bytes: 1024,
    modifiedMs: 1,
  },
};

function galleryProps(visibleItems: WallpaperGalleryItem[]) {
  return {
    t,
    tab: "library" as const,
    busy: false,
    locked: false,
    visibleItems,
    selectedId: null,
    previewingId: null,
    showEmptyBlock: false,
    emptyState: null,
    clearGalleryFilters: vi.fn(),
    openItemPreview: vi.fn(async () => {}),
    dropItem: vi.fn(),
    openExternalSource: vi.fn(),
    requestDeleteLibraryItem: vi.fn(),
    canLoadMore: false,
    loadingMore: false,
    onLoadMore: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WallpaperSourceGallery media details", () => {
  it.each(["library", "pexels"] as const)(
    "uses the local media endpoint for saved provider images in %s",
    (tab) => {
      const path = "C:/wallpapers/pexels/saved-photo.jpg";
      const providerItem: WallpaperGalleryItem = {
        ...item,
        id: "saved-pexels-photo",
        source: "pexels",
        localPath: path,
        fullUrl: `file://${path}`,
        thumbUrl: `file://${path}`,
      };

      render(
        <WallpaperSourceGallery
          {...galleryProps([providerItem])}
          tab={tab}
        />,
      );

      expect(screen.queryByTestId("remote-provider-thumbnail")).toBeNull();
      expect(screen.getByRole("img").getAttribute("src")).toBe(
        `http://127.0.0.1/media/${encodeURIComponent(path)}`,
      );
    },
  );

  it("keeps the existing media fallback when endpoint boot fails", async () => {
    ensureMediaEndpoint.mockRejectedValueOnce(new Error("endpoint unavailable"));
    const path = "H:/wallpapers/library/fallback.mp4";
    const videoItem: WallpaperGalleryItem = {
      ...item,
      id: "fallback-video",
      kind: "video",
      source: "library",
      localPath: path,
      fullUrl: `file://${path}`,
      thumbUrl: "",
    };
    resolveImageSrcSync.mockReturnValueOnce(null);
    const { container } = render(
      <WallpaperSourceGallery
        {...galleryProps([videoItem])}
        tab="library"
      />,
    );

    await waitFor(() => expect(ensureMediaEndpoint).toHaveBeenCalledOnce());
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      `file://${path}`,
    );
  });

  it.each(["library", "pexels"] as const)(
    "refreshes a local video in %s after the media endpoint becomes ready",
    async (tab) => {
      let finishEndpoint!: () => void;
      ensureMediaEndpoint.mockReturnValueOnce(
        new Promise((resolve) => {
          finishEndpoint = () => resolve(null);
        }),
      );
      resolveImageSrcSync.mockReturnValueOnce(null);
      const path = "H:/wallpapers/library/result.mp4";
      const videoItem: WallpaperGalleryItem = {
        ...item,
        id: "generated-video",
        kind: "video",
        source: "library",
        localPath: path,
        fullUrl: `file://${path}`,
        thumbUrl: "",
      };
      const { container } = render(
        <WallpaperSourceGallery
          {...galleryProps([videoItem])}
          tab={tab}
        />,
      );
      const video = container.querySelector("video");
      expect(video?.getAttribute("src")).toBe(`file://${path}`);
      await act(async () => finishEndpoint());
      expect(video?.getAttribute("src")).toBe(
        `http://127.0.0.1/media/${encodeURIComponent(path)}`,
      );
    },
  );

  it("closes details when filtering removes its card and does not reopen it", async () => {
    const view = render(
      <WallpaperSourceGallery {...galleryProps([item])} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.details.title: Saved artwork",
      }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();

    view.rerender(<WallpaperSourceGallery {...galleryProps([])} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.rerender(<WallpaperSourceGallery {...galleryProps([item])} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps load more after the cards inside the result scroller", () => {
    const onLoadMore = vi.fn();
    const remoteItem: WallpaperGalleryItem = {
      ...item,
      id: "remote-landscape",
      source: "pexels",
      localPath: undefined,
      width: 1600,
      height: 900,
    };
    const props = {
      ...galleryProps([remoteItem]),
      tab: "pexels" as const,
      canLoadMore: true,
      onLoadMore,
    };
    const { container } = render(<WallpaperSourceGallery {...props} />);

    const list = screen.getByRole("list");
    const card = screen.getByRole("listitem");
    const loadMore = screen.getByRole("button", {
      name: "settings.wallpaperSource.loadMore",
    });
    const shell = container.querySelector<HTMLElement>(
      ".wallpaper-masonry__media-shell",
    );

    expect(list.contains(loadMore)).toBe(true);
    expect(
      card.compareDocumentPosition(loadMore) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(shell?.style.aspectRatio).toBe("1600 / 900");

    fireEvent.click(loadMore);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("uses the generic loading label while appending any source", () => {
    render(
      <WallpaperSourceGallery
        {...galleryProps([item])}
        tab="openverse"
        canLoadMore
        loadingMore
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "settings.wallpaperSource.loadingMore",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
