export interface BusEvent {
  type: string;
  taskId?: string;
  data: unknown;
  at: string;
}

type Listener = (evt: BusEvent) => void;

/** In-process pub/sub bridging the orchestrator to SSE dashboard streams. */
export class EventBus {
  private listeners = new Set<Listener>();

  emit(type: string, data: unknown, taskId?: string): void {
    const evt: BusEvent = { type, taskId, data, at: new Date().toISOString() };
    for (const listener of this.listeners) {
      try {
        listener(evt);
      } catch {
        // A broken subscriber must not take down the emitter.
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
