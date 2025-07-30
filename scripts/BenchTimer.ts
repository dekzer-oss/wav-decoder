export class BenchTimer {
  private _sab = new SharedArrayBuffer(4);
  private _view = new Int32Array(this._sab);

  async time(cb: () => void | Promise<void>): Promise<number> {
    this._view[0] = 0;
    const wait = Atomics.waitAsync(this._view, 0, 0);

    const t0 = performance.now();
    await cb();
    Atomics.store(this._view, 0, 1);
    Atomics.notify(this._view, 0);
    await wait.value;
    const t1 = performance.now();

    return t1 - t0;
  }
}
