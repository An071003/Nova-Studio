import { CanvasNodeSchema, type CanvasNode } from '@nova/shared';
import * as Y from 'yjs';

/** Decodes and Zod-validates sorted CanvasNode records from raw Yjs document bytes. */
export function decodeNodesFromYDocBytes(bytes: Uint8Array): CanvasNode[] {
  const doc = new Y.Doc();
  try {
    if (bytes.byteLength > 0) {
      Y.applyUpdate(doc, bytes);
    }
    const nodesMap = doc.getMap('nodes');
    const result: CanvasNode[] = [];

    nodesMap.forEach((value) => {
      if (!(value instanceof Y.Map)) {
        return;
      }
      const raw: Record<string, unknown> = {};
      value.forEach((fieldVal, key) => {
        if (key === 'text' && fieldVal instanceof Y.Text) {
          raw[key] = fieldVal.doc !== null ? fieldVal.toString() : '';
        } else {
          raw[key] = fieldVal;
        }
      });
      if (raw.id !== undefined && raw.updatedAt === undefined) {
        raw.updatedAt = 0;
      }
      const parsed = CanvasNodeSchema.safeParse(raw);
      if (parsed.success) {
        result.push(parsed.data);
      }
    });

    result.sort((a, b) => {
      if (a.index < b.index) return -1;
      if (a.index > b.index) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    return result;
  } finally {
    doc.destroy();
  }
}
