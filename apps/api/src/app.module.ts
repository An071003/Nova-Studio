import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.service';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class AppModule {}
