import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  CreateExportSchema,
  type CreateExportDto,
  type ExportJobResponse,
} from '@nova/shared';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExportsService } from './exports.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class ExportsController {
  constructor(@Inject(ExportsService) private readonly exportsService: ExportsService) {}

  @Post('projects/:id/exports')
  @HttpCode(HttpStatus.CREATED)
  async createExport(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
    @Body(new ZodValidationPipe(CreateExportSchema)) body: CreateExportDto,
  ): Promise<ExportJobResponse> {
    return this.exportsService.createExport(user.id, projectId, body);
  }

  @Get('exports/:jobId')
  async getExportJob(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
  ): Promise<ExportJobResponse> {
    return this.exportsService.getExportJob(user.id, jobId);
  }

  @Get('projects/:id/thumbnail')
  async getProjectThumbnail(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType } = await this.exportsService.getProjectThumbnail(
      user.id,
      projectId,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(buffer);
  }

  @Post('projects/:id/thumbnail')
  @HttpCode(HttpStatus.OK)
  async refreshProjectThumbnail(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
  ): Promise<{ thumbnailUrl: string }> {
    return this.exportsService.refreshProjectThumbnail(user.id, projectId);
  }
}
