import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '../../auth/auth.guard';

@ApiTags('Dashboard')
@Controller('api/dashboard')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Dashboard principal', description: 'Retorna informações agregadas para a visão diária, semanal ou mensal.' })
  @ApiQuery({ name: 'period', required: true, description: 'day, week, ou month', example: 'day' })
  @ApiQuery({ name: 'date', required: true, description: 'Data base (ex: 2024-10-15 ou 2024-10)' })
  @ApiQuery({ name: 'areaId', required: false, description: 'ID da área de foco (ex: Corpo, Mente)' })
  @ApiResponse({ status: 200, description: 'Dados do dashboard.' })
  async getDashboard(
    @Query('period') period: 'day' | 'week' | 'month',
    @Query('date') date: string,
    @Query('areaId') areaId: string,
    @Req() req: any
  ) {
    if (period === 'day') {
      return this.dashboardService.getDashboardDay(req.user.userId, date, areaId);
    } else if (period === 'week') {
      return this.dashboardService.getDashboardWeek(req.user.userId, date, areaId);
    } else if (period === 'month') {
      return this.dashboardService.getDashboardMonth(req.user.userId, date, areaId);
    }
    return { error: 'Periodo inválido. Use day, week ou month.' };
  }
}
