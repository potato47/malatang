import type { ThemeMode } from "../shared/api";
import { appearanceUpdate, type AppearanceConfig, type AppearanceUpdate } from "../shared/theme";
import { Store } from "./store";

/** Serialize native appearance and persistence so windows and CLI share one preference. */
export class Appearance {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private store: Store,
    private apply: (theme: ThemeMode) => Promise<unknown>,
    private changed: (value: AppearanceConfig) => void,
  ) {}
  get(): AppearanceConfig {
    return {
      theme: this.store.value.theme,
      colorTheme: structuredClone(this.store.value.colorTheme),
    };
  }
  async restore() {
    await this.apply(this.store.value.theme);
  }
  set(input: AppearanceUpdate) {
    const result = this.queue.then(async () => {
      const patch = appearanceUpdate.parse(input);
      const previous = this.store.value.theme;
      const nativeChanged = patch.theme !== undefined && patch.theme !== previous;
      if (nativeChanged) await this.apply(patch.theme!);
      try {
        await this.store.update((state) => {
          if (patch.theme !== undefined) state.theme = patch.theme;
          if (patch.colorTheme !== undefined) state.colorTheme = patch.colorTheme;
        });
      } catch (error) {
        if (nativeChanged) await this.apply(previous);
        throw error;
      }
      this.changed(this.get());
      return this.get();
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
