/**
 * @vitest-environment jsdom
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";

vi.mock("@/lib/imageLightboxFit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imageLightboxFit")>(
    "@/lib/imageLightboxFit",
  );
  return {
    ...actual,
    loadImageNaturalSize: vi.fn(async () => ({ width: 1920, height: 1080 })),
  };
});

const providerState = vi.hoisted(() => ({
  busy: false,
  loadingMore: false,
  stage: null as string | null,
  canLoadMore: true,
}));
const webItems = vi.hoisted(() => [
  {
    id: "web-integration-image",
    thumbUrl: "https://images.example.test/wallpaper.jpg",
    fullUrl: "https://images.example.test/wallpaper.jpg",
    kind: "image" as const,
    source: "web" as const,
    width: 1920,
    height: 1080,
    sourceUrl: "https://photos.example.test/wallpaper",
    sourceName: "photos.example.test",
  },
]);
vi.mock("@/hooks/useWallpaperProviderController", () => ({
  useWallpaperProviderController: (options: {
    setItems: (items: typeof webItems) => void;
    setHasSearched: (value: boolean) => void;
  }) => ({
    ...providerState,
    search: async () => {
      options.setItems(webItems);
      options.setHasSearched(true);
    },
    loadMore: vi.fn(),
    cancel: vi.fn(async () => false),
    clear: vi.fn(async () => false),
    capture: vi.fn(() => null),
    restore: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  isDesktopHost: () => true,
  isTauri: () => false,
  wallpaperLibraryRemember: vi.fn(async () => ({ source: "web" })),
  wallpaperLibraryLookup: vi.fn(async () => []),
  wallpaperRemoteFetchMedia: vi.fn(async () => ({
    path: "H:\\wallpapers\\web-integration.jpg",
    name: "web-integration.jpg",
    mime: "image/jpeg",
    bytes: 1024,
  })),
  wallpaperRemoteThumbnail: vi.fn(async () => ({
    dataUrl: "data:image/jpeg;base64,YWJj",
    width: 32,
    height: 18,
  })),
  wallpaperRemoteCancelMediaRequests: vi.fn(async () => 0),
  wallpaperRemoteCancelAllMediaRequests: vi.fn(async () => 0),
  wallpaperLibraryList: vi.fn(),
  wallpaperLibraryPage: vi.fn(async () => ({
    items: [],
    nextCursor: null,
    total: 0,
    kindCounts: { all: 0, image: 0, video: 0 },
  })),
  wallpaperLibraryDelete: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("@/components/Select", () => ({
  Select: ({ value }: { value: string }) => <span>{value}</span>,
}));

import { ImageViewerProvider } from "./ImageViewer";
import { WallpaperSourceModal } from "./WallpaperSourceModal";
import { setMediaEndpoint } from "@/lib/imageSrc";
import * as api from "@/lib/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  setMediaEndpoint(null);
  providerState.busy = false;
  providerState.loadingMore = false;
  providerState.stage = null;
  providerState.canLoadMore = true;
});

describe("WallpaperSourceModal image viewer integration", () => {
  it("cancels only the remote Host request owned by a closed viewer", async () => {
    const pending = new Promise<{
      path: string;
      name: string;
      mime: string;
      bytes: number;
    }>(() => {});
    vi.mocked(api.wallpaperRemoteFetchMedia).mockReturnValueOnce(pending);
    setMediaEndpoint({
      baseUrl: "http://127.0.0.1:19200",
      token: "test-only",
    });
    render(
      <ImageViewerProvider locale="en">
        <WallpaperSourceModal
          open
          initialTab="web"
          t={(key) => key}
          onClose={vi.fn()}
          onPickFile={vi.fn()}
        />
      </ImageViewerProvider>,
    );

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "settings.wallpaperSource.search",
      }),
      { target: { value: "night skyline" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "settings.wallpaperSource.search" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.wallpaperSource.openPreview",
      }),
    );
    await waitFor(() =>
      expect(api.wallpaperRemoteFetchMedia).toHaveBeenCalledTimes(1),
    );
    const requestId = vi.mocked(api.wallpaperRemoteFetchMedia).mock.calls[0]?.[2];
    vi.mocked(api.wallpaperRemoteCancelMediaRequests).mockClear();
    vi.mocked(api.wallpaperRemoteCancelAllMediaRequests).mockClear();

    fireEvent.click(await screen.findByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(api.wallpaperRemoteCancelMediaRequests).toHaveBeenCalledWith([
        requestId,
      ]),
    );
    expect(api.wallpaperRemoteCancelAllMediaRequests).not.toHaveBeenCalled();
  });


  it("opens the real preview while a provider page is loading", async () => {
    const props = {
      open: true,
      initialTab: "web" as const,
      t: ((key: string) => key) as never,
      onClose: vi.fn(),
      onPickFile: vi.fn(),
    };
    const view = render(
      <ImageViewerProvider locale="en">
        <WallpaperSourceModal {...props} />
      </ImageViewerProvider>,
    );

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "settings.wallpaperSource.search",
      }),
      { target: { value: "night skyline" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "settings.wallpaperSource.search" }),
    );
    const card = await screen.findByRole("button", {
      name: "settings.wallpaperSource.openPreview",
    });

    providerState.busy = true;
    providerState.loadingMore = true;
    view.rerender(
      <ImageViewerProvider locale="en">
        <WallpaperSourceModal {...props} />
      </ImageViewerProvider>,
    );

    expect((card as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(card);
    await waitFor(() =>
      expect(document.querySelector(".yarl__portal")).not.toBeNull(),
    );
  });
});
