import { Controller, HttpCode, HttpStatus, Inject, Param, Post, UseGuards } from '@nestjs/common';
import type { WorkspaceSummary } from '@nova/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspacesService } from './workspaces.service';

@Controller('invites')
@UseGuards(JwtAuthGuard)
export class InvitesController {
  constructor(@Inject(WorkspacesService) private readonly workspaces: WorkspacesService) {}

  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  async acceptInvite(
    @CurrentUser() user: AuthUser,
    @Param('token') token: string,
  ): Promise<{ workspace: WorkspaceSummary }> {
    const workspace = await this.workspaces.acceptInvite(user.id, token);
    return { workspace };
  }
}
