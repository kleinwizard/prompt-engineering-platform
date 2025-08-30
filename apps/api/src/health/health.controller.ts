import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../modules/auth/decorators/public.decorator';
import { PrismaClient } from '@prisma/client';
import * as Redis from 'ioredis';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private prisma: PrismaClient;
  private redis: Redis.Redis;

  constructor() {
    this.prisma = new PrismaClient();
    this.redis = new Redis.Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: () => null, // Don't retry for health checks
      lazyConnect: true,
    });
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'Health check endpoint' })
  healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness check endpoint' })
  async readinessCheck() {
    const services = {
      database: 'disconnected',
      redis: 'disconnected',
      storage: 'unknown',
    };

    // Check database connectivity
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      services.database = 'connected';
    } catch (error) {
      services.database = 'error';
    }

    // Check Redis connectivity
    try {
      await this.redis.connect();
      await this.redis.ping();
      services.redis = 'connected';
      await this.redis.disconnect();
    } catch (error) {
      services.redis = 'error';
    }

    // Check storage (filesystem write test)
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const os = require('os');
      const testFile = path.join(os.tmpdir(), 'health-check-' + Date.now());
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
      services.storage = 'ready';
    } catch (error) {
      services.storage = 'error';
    }

    const allHealthy = Object.values(services).every(
      status => status === 'connected' || status === 'ready'
    );

    if (!allHealthy) {
      throw new HttpException(
        {
          status: 'not ready',
          services,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'ready',
      services,
    };
  }
}