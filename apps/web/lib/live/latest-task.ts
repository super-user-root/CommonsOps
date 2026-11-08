// Shared async state controller used by both refresh and intent derivation.
// Generation + input key gate completions even when a dependency ignores abort.
export interface LatestState<T> {
  readonly status: "IDLE" | "LOADING" | "READY" | "ERROR";
  readonly key: string | null;
  readonly dataKey: string | null;
  readonly data: T | null;
  readonly error: unknown;
}
export class LatestTask<T> {
  private state: LatestState<T> = Object.freeze({
    status: "IDLE",
    key: null,
    dataKey: null,
    data: null,
    error: null,
  });
  private generation = 0;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: LatestState<T>): void {
    this.state = Object.freeze(state);
    for (const listener of this.listeners) listener();
  }
  cancel(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }
  current(key: string): T | null {
    return this.state.status === "READY" && this.state.dataKey === key
      ? this.state.data
      : null;
  }
  async run(
    key: string,
    work: (signal: AbortSignal) => Promise<T>,
    replace = true,
  ): Promise<boolean> {
    if (!replace && this.state.status === "LOADING" && this.controller)
      return false;
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ ...this.state, status: "LOADING", key, error: null });
    try {
      const data = await work(controller.signal);
      if (generation !== this.generation || controller.signal.aborted)
        return false;
      this.publish({ status: "READY", key, dataKey: key, data, error: null });
      return true;
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted)
        return false;
      this.publish({ ...this.state, status: "ERROR", key, error });
      return false;
    } finally {
      if (generation === this.generation) this.controller = null;
    }
  }
}
