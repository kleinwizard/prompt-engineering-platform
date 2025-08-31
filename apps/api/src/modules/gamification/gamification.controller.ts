import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GamificationService } from './gamification.service';

@Controller('gamification')
@UseGuards(JwtAuthGuard)
export class GamificationController {
  constructor(private gamificationService: GamificationService) {}

  @Get('profile')
  async getUserProfile(@Request() req: any) {
    return this.gamificationService.getUserProfile(req.user.id);
  }

  @Get('leaderboard')
  async getLeaderboard() {
    return this.gamificationService.getLeaderboard();
  }

  @Get('badges')
  async getUserBadges(@Request() req: any) {
    return this.gamificationService.getUserBadges(req.user.id);
  }

  @Get('achievements')
  async getUserAchievements(@Request() req: any) {
    return this.gamificationService.getUserAchievements(req.user.id);
  }
}