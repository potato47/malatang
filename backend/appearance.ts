import type { ThemeMode } from "../shared/api";
import { Store } from "./store";

/** Serialize native appearance and persistence so windows and CLI share one preference. */
export class Appearance {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: Store, private apply: (theme: ThemeMode) => Promise<unknown>, private changed: (theme: ThemeMode) => void) {}
  get() { return { theme: this.store.value.theme }; }
  async restore() { await this.apply(this.store.value.theme); }
  set(theme: ThemeMode) {
    const result = this.queue.then(async () => {
      const previous = this.store.value.theme;
      await this.apply(theme);
      try { await this.store.update(state => { state.theme = theme; }); }
      catch (error) { await this.apply(previous); throw error; }
      this.changed(theme);
      return this.get();
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
