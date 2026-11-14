import { SHARED_VERSION } from '@nova/shared';

export const WORKER_SERVICE_VERSION = SHARED_VERSION;

export { processAssetImage, type ProcessedAssetImage } from './image-processor.js';
export {
  createAssetWorker,
  thumbnailKeyForAsset,
  type AssetWorkerOptions,
} from './asset-worker.js';
