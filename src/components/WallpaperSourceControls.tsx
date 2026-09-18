import type { WallpaperSourceModalProps } from "./WallpaperSourceModal";

type Props = {
  t: WallpaperSourceModalProps["t"];
  busy: boolean;
  locked: boolean;
  loadLibrary: () => Promise<void>;
};

/** Legacy-compatible local-library controls; remote providers render their own search UI. */
export function WallpaperSourceControls({ t, busy, locked, loadLibrary }: Props) {
  return (
    <div className="wallpaper-source-form">
      <div className="wallpaper-source-form__row">
        <button
          type="button"
          className="btn btn--solid"
          disabled={locked}
          onClick={() => void loadLibrary()}
        >
          {busy
            ? t("settings.wallpaperSource.libraryLoading")
            : t("settings.wallpaperSource.libraryRefresh")}
        </button>
      </div>
    </div>
  );
}
