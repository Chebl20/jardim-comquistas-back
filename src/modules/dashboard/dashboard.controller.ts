import { Controller, Get, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '../../auth/auth.guard';
import { DashboardWeekResponseDto } from './dto/dashboard-week.response';
import { DashboardDayResponseDto } from './dto/dashboard-day.response';

@ApiTags('Dashboard')
@Controller('api/dashboard')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Dashboard principal',
    description:
      'Retorna informações agregadas para a visão diária, semanal ou mensal. ' +
      'Na visão day (`period=day`), `goals[].dailyStatus` e `goals[].reminder.dailyStatus` ' +
      'refletem a `date` consultada (DONE só no dia da conclusão; senão PENDING). ' +
      'Na visão week (`period=week`), cada meta em `weekGrid[].goals` inclui `times` (HH:mm).',
  })
  @ApiQuery({
    name: 'period',
    required: true,
    description: 'day, week, ou month',
    example: 'week',
  })
  @ApiQuery({
    name: 'date',
    required: true,
    description:
      'Data base. day/week: YYYY-MM-DD (qualquer dia da semana; week calcula seg–dom). month: YYYY-MM ou YYYY-MM-DD',
    example: '2026-08-26',
  })
  @ApiQuery({
    name: 'areaId',
    required: false,
    description: 'Filtro por área de conquista (ex: Corpo, Mente)',
  })
  @ApiResponse({
    status: 200,
    description: 'Visão day: metas do dia com dailyStatus contextual à date.',
    type: DashboardDayResponseDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Visão week: weekGrid com metas e horários (times) por dia.',
    type: DashboardWeekResponseDto,
  })
  async getDashboard(
    @Query('period') period: 'day' | 'week' | 'month',
    @Query('date') date: string,
    @Query('areaId') areaId: string,
    @Req() req: any,
  ) {
    if (period === 'day') {
      return this.dashboardService.getDashboardDay(
        req.user.userId,
        date,
        areaId,
      );
    } else if (period === 'week') {
      return this.dashboardService.getDashboardWeek(
        req.user.userId,
        date,
        areaId,
      );
    } else if (period === 'month') {
      return this.dashboardService.getDashboardMonth(
        req.user.userId,
        date,
        areaId,
      );
    }
    throw new BadRequestException('Periodo inválido. Use day, week ou month.');
  }
}
