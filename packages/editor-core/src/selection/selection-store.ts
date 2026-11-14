import type { Rect } from '../geometry/geometry.js';

export interface SelectionSnapshot {
  ids: string[];
  hoveredId: string | null;
  marqueeRect: Rect | null;
}

export type SelectionListener = (snapshot: SelectionSnapshot) => void;

/** Stores local node selection, hover target, and active marquee rectangle. */
export class SelectionStore {
  private ids: string[] = [];
  private hoveredId: string | null = null;
  private marqueeRect: Rect | null = null;
  private readonly listeners = new Set<SelectionListener>();

  getIds(): string[] {
    return this.ids;
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  getHoveredId(): string | null {
    return this.hoveredId;
  }

  getMarqueeRect(): Rect | null {
    return this.marqueeRect;
  }

  getSnapshot(): SelectionSnapshot {
    return {
      ids: [...this.ids],
      hoveredId: this.hoveredId,
      marqueeRect: this.marqueeRect ? { ...this.marqueeRect } : null,
    };
  }

  set(ids: string[]): void {
    const deduped = Array.from(new Set(ids));
    if (
      deduped.length === this.ids.length &&
      deduped.every((v, idx) => v === this.ids[idx])
    ) {
      return;
    }
    this.ids = deduped;
    this.emit();
  }

  toggle(id: string): void {
    if (this.ids.includes(id)) {
      this.set(this.ids.filter((item) => item !== id));
    } else {
      this.set([...this.ids, id]);
    }
  }

  add(ids: string[]): void {
    this.set([...this.ids, ...ids]);
  }

  remove(ids: string[]): string[] {
    const dropSet = new Set(ids);
    const removed = this.ids.filter((id) => dropSet.has(id));
    if (removed.length === 0) {
      return [];
    }
    this.ids = this.ids.filter((id) => !dropSet.has(id));
    if (this.hoveredId && dropSet.has(this.hoveredId)) {
      this.hoveredId = null;
    }
    this.emit();
    return removed;
  }

  clear(): void {
    this.set([]);
  }

  setHovered(id: string | null): void {
    if (this.hoveredId === id) {
      return;
    }
    this.hoveredId = id;
    this.emit();
  }

  setMarqueeRect(rect: Rect | null): void {
    this.marqueeRect = rect ? { ...rect } : null;
    this.emit();
  }

  subscribe(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.listeners.clear();
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const cb of this.listeners) {
      cb(snap);
    }
  }
}
