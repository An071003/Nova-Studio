import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
  type CreateWorkspaceDto,
  type UpdateWorkspaceDto,
  type WorkspaceMemberDto,
  type WorkspaceSummary,
} from '@nova/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(@Inject(WorkspacesService) private readonly workspaces: WorkspacesService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateWorkspaceSchema)) dto: CreateWorkspaceDto,
  ): Promise<{ workspace: WorkspaceSummary }> {
    const workspace = await this.workspaces.create(user.id, dto);
    return { workspace };
  }

  @Get(':id')
  async getOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ workspace: WorkspaceSummary }> {
    const workspace = await this.workspaces.getById(user.id, id);
    return { workspace };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWorkspaceSchema)) dto: UpdateWorkspaceDto,
  ): Promise<{ workspace: WorkspaceSummary }> {
    const workspace = await this.workspaces.update(user.id, id, dto);
    return { workspace };
  }

  @Get(':id/members')
  async listMembers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ members: WorkspaceMemberDto[] }> {
    const members = await this.workspaces.listMembers(user.id, id);
    return { members };
  }
}
