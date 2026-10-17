/** Holds future model calls only after all already-admitted calls finish. */
export class RequestPauseGate {
  private active = 0;
  private requested: string | null = null;
  private reached = false;
  private waiting: Array<() => void> = [];

  constructor(private notifyReached: (id: string) => void) {}

  request(id: string) {
    if (!id || this.requested) throw new Error("A pause is already requested");
    this.requested = id;
    this.reached = false;
    this.notifyIfReady();
  }

  async enter(): Promise<void> {
    if (!this.requested) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
      this.notifyIfReady();
    });
  }

  leave() {
    if (this.active <= 0) throw new Error("No admitted model call to leave");
    this.active--;
    this.notifyIfReady();
  }

  resume(id: string) {
    if (!this.requested || this.requested !== id || !this.reached)
      throw new Error("Pause has not reached a safe request boundary");
    this.requested = null;
    this.reached = false;
    const waiting = this.waiting.splice(0);
    this.active += waiting.length;
    waiting.forEach((resolve) => resolve());
  }

  private notifyIfReady() {
    if (
      this.requested &&
      !this.reached &&
      this.active === 0 &&
      this.waiting.length
    ) {
      this.reached = true;
      this.notifyReached(this.requested);
    }
  }
}
