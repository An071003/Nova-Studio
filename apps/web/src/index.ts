import { EDITOR_CORE_VERSION } from '@nova/editor-core';
import { EDITOR_KONVA_VERSION } from '@nova/editor-konva';
import { SHARED_VERSION } from '@nova/shared';
import { UI_TOKENS_VERSION } from '@nova/ui';

export const WEB_APP_VERSION =
  SHARED_VERSION + EDITOR_CORE_VERSION + EDITOR_KONVA_VERSION + UI_TOKENS_VERSION;
