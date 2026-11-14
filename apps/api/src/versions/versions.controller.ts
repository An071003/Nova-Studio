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
  CreateVersionSchema,
  RestoreVersionBodySchema,
  type CreateVersionDto,
  type RestoreVersionBodyDto,
  type RestoreVersionResponse,
  type VersionPreview,
  type VersionSummary,
} from '@nova/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { VersionsService } from './versions.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class VersionsController {
  constructor(@Inject(VersionsService) private readonly versions: VersionsService) {}

  @Get('projects/:id/versions')
  async listVersions(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
  ): Promise<{ versions: VersionSummary[] }> {
    return this.versions.listVersions(user.id, projectId);
  }

  @Post('projects/:id/versions')
  @HttpCode(HttpStatus.CREATED)
  async createVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
    @Body(new ZodValidationPipe(CreateVersionSchema)) body: CreateVersionDto,
  ): Promise<{ version: VersionSummary }> {
    return this.versions.createVersion(user.id, projectId, body);
  }

  @Get('projects/:id/versions/:vid/preview')
  async getVersionPreview(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
    @Param('vid') versionId: string,
  ): Promise<VersionPreview> {
    return this.versions.getVersionPreview(user.id, projectId, versionId);
  }

  @Post('projects/:id/versions/:vid/restore')
  @HttpCode(HttpStatus.OK)
  async restoreVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
    @Param('vid') versionId: string,
    @Body() rawBody?: unknown,
  ): Promise<RestoreVersionResponse> {
    const body: RestoreVersionBodyDto = rawBody
      ? new ZodValidationPipe(RestoreVersionBodySchema).transform(rawBody)
      : {};
    return this.versions.restoreVersion(user.id, projectId, versionId, body);
  }
}
