import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DashboardDayOccurrenceDto } from './dashboard-day.response';

export class DashboardMonthDayDto {
  @ApiProperty({ description: 'Data do dia (ISO)', example: '2026-10-16' })
  date: string | null;

  @ApiProperty({ description: 'Total de slots esperados no dia', example: 2 })
  expectedSlots: number;

  @ApiProperty({ description: 'Colheitas registradas no dia', example: 1 })
  harvestCount: number;

  @ApiProperty({
    type: [DashboardDayOccurrenceDto],
    description:
      'Mesmo item do Dia: 1 occurrence por meta (primeiro times), instanceId da célula.',
  })
  occurrences: DashboardDayOccurrenceDto[];
}

export class DashboardMonthProgressDto {
  @ApiProperty({ example: 13 })
  percentage: number;

  @ApiProperty({ example: 31 })
  total: number;

  @ApiProperty({ example: 4 })
  harvested: number;
}

export class DashboardMonthHighlightDto {
  @ApiProperty({ format: 'uuid' })
  goalId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  harvestCount: number;
}

export class DashboardMonthResponseDto {
  @ApiProperty({ example: '2026-10' })
  month: string | null;

  @ApiPropertyOptional({ example: 'Corpo', nullable: true })
  areaId: string | null;

  @ApiProperty({ example: '2026-10-01', nullable: true })
  monthStart: string | null;

  @ApiProperty({ example: '2026-10-31', nullable: true })
  monthEnd: string | null;

  @ApiProperty({ type: [DashboardMonthDayDto] })
  monthGrid: DashboardMonthDayDto[];

  @ApiProperty({ type: DashboardMonthProgressDto })
  monthlyGoal: DashboardMonthProgressDto;

  @ApiProperty({ example: 2 })
  activeDays: number;

  @ApiProperty({ type: [DashboardMonthHighlightDto] })
  monthHighlights: DashboardMonthHighlightDto[];
}
