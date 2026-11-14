import {
  getDocRoots,
  readNodeFromMap,
  RESTORE_ORIGIN,
  writeNodeToMap,
} from '@nova/editor-core';
import * as Y from 'yjs';
import { z } from 'zod';

export const RESTORE_CHANNEL_PREFIX = 'nova:restore:';

const RestoreEnvelopeSchema = z.object({
  stateBase64: z.string().min(1).optional(),
  snapshotBase64: z.string().min(1).optional(),
});

/** Decodes a Redis `nova:restore:<projectId>` payload (raw base64 or JSON wrapper) into Yjs snapshot bytes. */
export function decodeRestoreMessage(rawMessage: string): Uint8Array {
  const trimmed = rawMessage.trim();
  if (!trimmed) {
    throw new Error('Empty restore payload');
  }

  let base64 = trimmed;
  if (trimmed.startsWith('{')) {
    const parsed = RestoreEnvelopeSchema.parse(JSON.parse(trimmed));
    base64 = parsed.stateBase64 ?? parsed.snapshotBase64 ?? '';
    if (!base64) {
      throw new Error('Restore envelope missing stateBase64/snapshotBase64');
    }
  }

  return new Uint8Array(Buffer.from(base64, 'base64'));
}

const NODE_MAP_FIELDS = [
  'id',
  'type',
  'pageId',
  'parentId',
  'index',
  'name',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'locked',
  'fill',
  'stroke',
  'strokeWidth',
  'cornerRadius',
  'points',
  'text',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'align',
  'lineHeight',
  'assetId',
  'createdBy',
  'updatedAt',
] as const;

function syncFlatMap(target: Y.Map<unknown>, live: Y.Map<unknown>): void {
  for (const key of Array.from(live.keys())) {
    if (!target.has(key)) {
      live.delete(key);
    }
  }
  target.forEach((value, key) => {
    live.set(key, value);
  });
}

/**
 * Reconciles a live Y.Doc in-place to match `snapshotBytes` inside a single `RESTORE_ORIGIN`
 * transaction so connected clients perform non-monotonic rollback cleanly via CRDT updates.
 */
export function reconcileDocToSnapshot(liveDoc: Y.Doc, snapshotBytes: Uint8Array): void {
  const targetDoc = new Y.Doc();
  try {
    Y.applyUpdate(targetDoc, snapshotBytes);

    const targetRoots = getDocRoots(targetDoc);
    const liveRoots = getDocRoots(liveDoc);

    liveDoc.transact(() => {
      syncFlatMap(targetRoots.meta, liveRoots.meta);

      for (const pageId of Array.from(liveRoots.pages.keys())) {
        if (!targetRoots.pages.has(pageId)) {
          liveRoots.pages.delete(pageId);
        }
      }
      targetRoots.pages.forEach((targetPage, pageId) => {
        let livePage = liveRoots.pages.get(pageId);
        if (!livePage) {
          livePage = new Y.Map<unknown>();
          liveRoots.pages.set(pageId, livePage);
        }
        syncFlatMap(targetPage, livePage);
      });

      for (const nodeId of Array.from(liveRoots.nodes.keys())) {
        if (!targetRoots.nodes.has(nodeId)) {
          liveRoots.nodes.delete(nodeId);
        }
      }

      targetRoots.nodes.forEach((targetNodeMap, nodeId) => {
        const parsedNode = readNodeFromMap(targetNodeMap);
        if (!parsedNode) {
          return;
        }
        let liveNodeMap = liveRoots.nodes.get(nodeId);
        if (!liveNodeMap) {
          liveNodeMap = new Y.Map<unknown>();
          liveRoots.nodes.set(nodeId, liveNodeMap);
        }
        for (const field of NODE_MAP_FIELDS) {
          if (field === 'text' && parsedNode.type === 'text') {
            continue;
          }
          if (!(field in parsedNode) || parsedNode[field] === undefined) {
            if (liveNodeMap.has(field)) {
              liveNodeMap.delete(field);
            }
          }
        }
        writeNodeToMap(liveNodeMap, parsedNode);
      });
    }, RESTORE_ORIGIN);
  } finally {
    targetDoc.destroy();
  }
}
