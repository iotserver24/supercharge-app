/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GROK_DISPLAY_VERSION?: string;
  readonly VITE_SUPERCHARGE_RELEASES_URL?: string;
  /** Legacy build-time alias retained for existing local environments. */
  readonly VITE_GROK_RELEASES_URL?: string;
}

declare module "plyr" {
  export interface PlyrOptions {
    controls?: string[];
    settings?: string[];
    ratio?: string;
    autoplay?: boolean;
    muted?: boolean;
    [key: string]: unknown;
  }
  export default class Plyr {
    constructor(target: HTMLElement | string, options?: PlyrOptions);
    destroy(): void;
    source: unknown;
  }
}

declare module "plyr/dist/plyr.css";
