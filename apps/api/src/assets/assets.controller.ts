import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateUploadUrlSchema,
  type AssetDto,
  type AssetUrlResponse,
  type CreateUploadUrlDto,
  type UploadUrlResponse,
} from '@nova/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AssetsService } from './assets.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}

  @Post('projects/:id/assets/upload-url')
  async createUploadUrl(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
    @Body(new ZodValidationPipe(CreateUploadUrlSchema)) dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponse> {
    return this.assets.createUploadUrl(user.id, projectId, dto);
  }

  @Post('assets/:assetId/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmAsset(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
  ): Promise<{ asset: AssetDto }> {
    return this.assets.confirmAsset(user.id, assetId);
  }

  @Get('projects/:id/assets')
  async listProjectAssets(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
  ): Promise<{ assets: AssetDto[] }> {
    return this.assets.listProjectAssets(user.id, projectId);
  }

  @Get('assets/:assetId/url')
  async getAssetUrl(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
  ): Promise<AssetUrlResponse> {
    return this.assets.getAssetUrl(user.id, assetId);
  }
}
