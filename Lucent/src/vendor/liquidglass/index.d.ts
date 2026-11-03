// Minimal typings for the vendored @ybouane/liquidglass v1.0.3 bundle (MIT, https://github.com/ybouane/liquidglass)
export interface LiquidGlassOptions {
  root: HTMLElement;
  glassElements?: NodeListOf<Element> | HTMLElement[];
  defaults?: Record<string, number | boolean>;
}
export declare class LiquidGlass {
  static init(options: LiquidGlassOptions): Promise<LiquidGlass>;
  fps: number;
  destroy(): void;
  markChanged(element?: HTMLElement): void;
}
