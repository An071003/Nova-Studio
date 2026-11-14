import { SHARED_VERSION } from '@nova/shared';

export const WORKER_SERVICE_VERSION = SHARED_VERSION;

export { processAssetImage, type ProcessedAssetImage } from './image-processor.js';
export {
  createAssetWorker,
  thumbnailKeyForAsset,
  type AssetWorkerOptions,
} from './asset-worker.js';
export {
  DEFAULT_AUTO_VERSION_INTERVAL_MS,
  DEFAULT_MAX_AUTO_VERSIONS,
  createAutoVersionWorker,
  createPrismaAutoVersionStore,
  runAutoVersionSweep,
  type AutoVersionCandidateProject,
  type AutoVersionLatestSnapshot,
  type AutoVersionStore,
  type AutoVersionSweepResult,
  type AutoVersionWorkerOptions,
} from './version-worker.js';
export {
  PROJECT_THUMBNAIL_BG,
  PROJECT_THUMBNAIL_HEIGHT,
  PROJECT_THUMBNAIL_WIDTH,
  createExportWorker,
  projectThumbnailKey,
  renderScenePngBuffer,
  renderSceneThumbnailWebp,
  type ExportWorkerOptions,
  type RenderScenePngInput,
  type RenderSceneThumbnailInput,
  type RenderedPngResult,
} from './export-worker.js';
