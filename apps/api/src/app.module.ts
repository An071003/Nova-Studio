import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { AssetsModule } from './assets/assets.module';
import { ExportsModule } from './exports/exports.module';
import { HealthController } from './health/health.controller';
import { PermissionsModule } from './permissions/permission.service';
import { PrismaModule } from './prisma/prisma.service';
import { ProjectsModule } from './projects/projects.module';
import { VersionsModule } from './versions/versions.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    PrismaModule,
    PermissionsModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 300,
      },
    ]),
    AuthModule,
    WorkspacesModule,
    ProjectsModule,
    VersionsModule,
    AssetsModule,
    ExportsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
