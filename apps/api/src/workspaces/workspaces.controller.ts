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
  UseGuards,
} from '@nestjs/common';
import {
  CreateInviteSchema,
  CreateWorkspaceSchema,
  UpdateMemberRoleSchema,
  UpdateWorkspaceSchema,
  type CreateInviteDto,
  type CreateWorkspaceDto,
  type InviteResponse,
  type UpdateMemberRoleDto,
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

  @Patch(':id/members/:userId')
  async updateMemberRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body(new ZodValidationPipe(UpdateMemberRoleSchema)) dto: UpdateMemberRoleDto,
  ): Promise<{ member: WorkspaceMemberDto }> {
    const member = await this.workspaces.updateMemberRole(user.id, id, targetUserId, dto);
    return { member };
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    await this.workspaces.removeMember(user.id, id, targetUserId);
  }

  @Post(':id/invites')
  async createInvite(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateInviteSchema)) dto: CreateInviteDto,
  ): Promise<InviteResponse> {
    return this.workspaces.createInvite(user.id, id, dto);
  }
}
