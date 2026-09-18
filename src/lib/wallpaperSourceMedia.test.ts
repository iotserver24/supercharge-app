import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchRemote: vi.fn(),
  remember: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  wallpaperRemoteFetchMedia: mocks.fetchRemote,
  wallpaperRemoteCancelMediaRequests: vi.fn(async () => 0),
  wallpaperRemoteCancelAllMediaRequests: vi.fn(async () => 0),
  wallpaperLibraryRemember: mocks.remember,
}));

import { ensureLocalWallpaperMedia } from "./wallpaperSourceMedia";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureLocalWallpaperMedia", () => {
  it("returns an existing local item without another Host write", async () => {
    const metadata = { id: "saved", favorite: true };

    await expect(
      ensureLocalWallpaperMedia({
        id: "saved",
        source: "library",
        kind: "image",
        thumbUrl: "file:///wallpapers/saved.jpg",
        fullUrl: "file:///wallpapers/saved.jpg",
        localPath: "C:/wallpapers/saved.jpg",
        metadata: metadata as never,
      }),
    ).resolves.toEqual({
      path: "C:/wallpapers/saved.jpg",
      metadata,
    });
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("downloads a licensed original through its Host route and records provenance", async () => {
    const item = {
      id: "licensed",
      source: "openverse",
      kind: "image",
      thumbUrl: "https://cdn.example.test/thumb.jpg",
      fullUrl: "https://cdn.example.test/photo.jpg",
      sourceUrl: "https://openverse.org/image/source",
      license: "CC BY 4.0",
    };
    mocks.fetchRemote.mockResolvedValue({
      path: "C:/wallpapers/photo.jpg",
      name: "photo.jpg",
      mime: "image/jpeg",
    });
    const metadata = { id: "media-1", favorite: false };
    mocks.remember.mockResolvedValue(metadata);

    const result = await ensureLocalWallpaperMedia(item);

    expect(mocks.fetchRemote).toHaveBeenCalledWith(
      "openverse",
      item.fullUrl,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(mocks.remember).toHaveBeenCalledWith(
      "C:/wallpapers/photo.jpg",
      item,
    );
    expect(result).toEqual({
      path: "C:/wallpapers/photo.jpg",
      name: "photo.jpg",
      mime: "image/jpeg",
      metadata,
    });
  });

  it("cancels only the remote Host request owned by an aborted consumer", async () => {
    const item = {
      id: "cancelled-preview",
      source: "web",
      kind: "image",
      thumbUrl: "https://images.example.test/thumb.jpg",
      fullUrl: "https://images.example.test/original.jpg",
    };
    mocks.fetchRemote.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();

    const pending = ensureLocalWallpaperMedia(item, {
      signal: controller.signal,
    });
    const requestId = mocks.fetchRemote.mock.calls[0]?.[2] as string;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.fetchRemote).toHaveBeenCalledWith(
      "web",
      item.fullUrl,
      requestId,
    );
    const { wallpaperRemoteCancelMediaRequests } = await import("@/lib/api");
    expect(wallpaperRemoteCancelMediaRequests).toHaveBeenCalledWith([requestId]);
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("rejects unsupported remote sources without calling a legacy fetch route", async () => {
    await expect(
      ensureLocalWallpaperMedia({
        id: "legacy",
        source: "x",
        kind: "image",
        thumbUrl: "https://example.test/thumb.jpg",
        fullUrl: "https://example.test/original.jpg",
      }),
    ).rejects.toThrow("url_blocked");
    expect(mocks.remember).not.toHaveBeenCalled();
  });
});
