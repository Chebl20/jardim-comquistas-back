import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProgressService } from './progress.service';
import { AuthGuard } from '../../auth/auth.guard';

@ApiTags('Progress')
@Controller('api/progress')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get('week')
  @ApiOperation({ summary: 'Progresso Semanal' })
  @ApiQuery({ name: 'date', required: true })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiResponse({ status: 200, description: 'Estatísticas semanais' })
  async getWeeklyProgress(
    @Query('date') date: string,
    @Query('areaId') areaId: string | undefined,
    @Req() req: any,
  ) {
    return this.progressService.getWeeklyProgress(
      req.user.userId,
      date,
      areaId,
    );
  }

  @Get('month')
  @ApiOperation({ summary: 'Progresso Mensal' })
  @ApiQuery({ name: 'month', required: true })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiResponse({ status: 200, description: 'Estatísticas mensais' })
  async getMonthlyProgress(
    @Query('month') month: string,
    @Query('areaId') areaId: string,
    @Req() req: any,
  ) {
    return this.progressService.getMonthlyProgress(
      req.user.userId,
      month,
      areaId,
    );
  }

  @Get('streaks')
  @ApiOperation({ summary: 'Conquistas e Streaks' })
  @ApiResponse({ status: 200, description: 'Dias seguidos' })
  async getStreaks(@Req() req: any) {
    return this.progressService.getStreaks(req.user.userId);
  }
}
