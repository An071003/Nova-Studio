import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateProjectSchema,
  CursorPaginationQuerySchema,
  UpdateProjectSchema,
  type CreateProjectDto,
  type CursorPaginationQuery,
  type ProjectDetailResponse,
  type ProjectSummary,
  type UpdateProjectDto,
} from '@nova/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProjectsService } from './projects.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get('workspaces/:id/projects')
  async listInWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Query(new ZodValidationPipe(CursorPaginationQuerySchema)) query: CursorPaginationQuery,
  ): Promise<{ projects: ProjectSummary[]; nextCursor: string | null }> {
    return this.projects.listInWorkspace(user.id, workspaceId, query);
  }

  @Post('workspaces/:id/projects')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateProjectSchema)) dto: CreateProjectDto,
  ): Promise<ProjectDetailResponse> {
    return this.projects.create(user.id, workspaceId, dto);
  }

  @Get('projects/:id')
  async getOne(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
  ): Promise<ProjectDetailResponse> {
    return this.projects.getById(user.id, projectId);
  }

  @Patch('projects/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) dto: UpdateProjectDto,
  ): Promise<ProjectDetailResponse> {
    return this.projects.update(user.id, projectId, dto);
  }

  @Delete('projects/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
  ): Promise<void> {
    await this.projects.remove(user.id, projectId);
  }

  @Post('projects/:id/duplicate')
  async duplicate(
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
  ): Promise<ProjectDetailResponse> {
    return this.projects.duplicate(user.id, projectId);
  }
}
