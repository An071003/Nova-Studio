import { CanvasNodeSchema, type CanvasNode } from '@nova/shared';

export const NOVA_CLIPBOARD_MIME = 'application/x-nova+json';

/** Serializes/deserializes canvas nodes for copy/cut/paste with progressive paste staggering. */
export class ClipboardManager {
  private internalNodes: CanvasNode[] = [];
  private pasteCount = 0;

  copy(nodes: CanvasNode[]): string {
    // Deep clone plain JSON objects
    this.internalNodes = nodes.map((n) => ({
      ...n,
      ...(n.points ? { points: [...n.points] } : {}),
    }));
    this.pasteCount = 0;
    return ClipboardManager.serializeNodes(this.internalNodes);
  }

  readInternal(): { nodes: CanvasNode[]; offset: { x: number; y: number } } | null {
    if (this.internalNodes.length === 0) {
      return null;
    }
    this.pasteCount += 1;
    const step = this.pasteCount * 20;
    return {
      nodes: this.internalNodes,
      offset: { x: step, y: step },
    };
  }

  nextPasteOffset(): { x: number; y: number } {
    this.pasteCount += 1;
    const step = this.pasteCount * 20;
    return { x: step, y: step };
  }

  hasContent(): boolean {
    return this.internalNodes.length > 0;
  }

  static serializeNodes(nodes: CanvasNode[]): string {
    return JSON.stringify({
      kind: 'nova-nodes',
      version: 1,
      nodes,
    });
  }

  static parseSerializedNodes(raw: string): CanvasNode[] | null {
    try {
      const json: unknown = JSON.parse(raw);
      if (typeof json !== 'object' || json === null) {
        return null;
      }
      const record = json as Record<string, unknown>;
      if (record.kind !== 'nova-nodes' || record.version !== 1 || !Array.isArray(record.nodes)) {
        return null;
      }
      const nodes: CanvasNode[] = [];
      for (const item of record.nodes) {
        const parsed = CanvasNodeSchema.safeParse(item);
        if (!parsed.success) {
          return null;
        }
        nodes.push(parsed.data);
      }
      return nodes;
    } catch {
      return null;
    }
  }
}
