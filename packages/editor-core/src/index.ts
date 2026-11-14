import { SHARED_VERSION } from '@nova/shared';

export const EDITOR_CORE_VERSION = SHARED_VERSION;

export * from './model/indexing.js';
export * from './model/doc.js';
export * from './commands/commands.js';
export * from './scene/scene-graph.js';
export * from './scene/spatial-index.js';
export * from './geometry/geometry.js';
export * from './snapping/snapping.js';
export * from './selection/selection-store.js';
export * from './viewport/viewport-store.js';
export * from './history/history-manager.js';
export * from './clipboard/clipboard.js';
export * from './presence/presence-manager.js';
export * from './tools/tool-manager.js';
export * from './editor.js';
