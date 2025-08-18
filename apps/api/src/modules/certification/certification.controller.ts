import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CertificationService } from './certification.service';

@Controller('certifications')
@UseGuards(JwtAuthGuard)
export class CertificationController {
  constructor(private certificationService: CertificationService) {}

  @Get()
  async getAllCertifications() {
    return this.certificationService.getAllCertifications();
  }

  @Get('my')
  async getMyCertifications(@Request() req) {
    return this.certificationService.getUserCertifications(req.user.id);
  }

  @Get('stats')
  async getCertificationStats() {
    return this.certificationService.getCertificationStats();
  }

  @Get('leaderboard')
  async getLeaderboard(@Query('certificationId') certificationId?: string) {
    return this.certificationService.getCertificationLeaderboard(certificationId);
  }

  @Get(':id')
  async getCertification(@Param('id') id: string) {
    return this.certificationService.getCertificationById(id);
  }

  @Get(':id/progress')
  async getCertificationProgress(@Param('id') id: string, @Request() req) {
    return this.certificationService.checkCertificationProgress(req.user.id, id);
  }

  @Post(':id/enroll')
  async enrollInCertification(@Param('id') id: string, @Request() req) {
    return this.certificationService.checkCertificationProgress(req.user.id, id);
  }

  @Get('verify/:code')
  async verifyCertificate(@Param('code') code: string) {
    return this.certificationService.verifyCertificate(code);
  }

  @Post('initialize')
  async initializeCertifications() {
    return this.certificationService.initializeCertificationLevels();
  }
}