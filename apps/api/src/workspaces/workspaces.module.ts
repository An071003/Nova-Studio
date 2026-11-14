import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitesController } from './invites.controller';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [AuthModule],
  controllers: [WorkspacesController, InvitesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
