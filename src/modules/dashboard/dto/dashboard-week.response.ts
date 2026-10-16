import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DashboardDayOccurrenceDto } from './dashboard-day.response';

export class DashboardWeekDayDto {
  @ApiProperty({ description: 'Data do dia (ISO)', example: '2026-08-26' })
  date: string | null;

  @ApiProperty({ description: 'Total de slots esperados no dia', example: 4 })
  expectedSlots: number;

  @ApiProperty({ description: 'Colheitas registradas no dia', example: 0 })
  harvestCount: number;

  @ApiProperty({
    type: [DashboardDayOccurrenceDto],
    description:
      'Mesmo item do Dia: 1 occurrence por meta (primeiro times), instanceId da célula.',
  })
  occurrences: DashboardDayOccurrenceDto[];
}

export class DashboardWeekProgressDto {
  @ApiProperty({ example: 50 })
  percentage: number;

  @ApiProperty({ example: 10 })
  total: number;

  @ApiProperty({ example: 5 })
  harvested: number;
}

export class DashboardWeekGardenLayerDto {
  @ApiProperty({ example: 'Corpo' })
  conquestType: string;

  @ApiProperty({ example: 3 })
  goalCount: number;
}

export class DashboardWeekResponseDto {
  @ApiProperty({
    description: 'Data base informada na query',
    example: '2026-08-26',
  })
  date: string | null;

  @ApiPropertyOptional({
    description: 'Filtro de área',
    example: 'Corpo',
    nullable: true,
  })
  areaId: string | null;

  @ApiProperty({
    description: 'Início da semana (segunda)',
    example: '2026-08-24',
  })
  weekStart: string | null;

  @ApiProperty({
    description: 'Fim da semana (domingo)',
    example: '2026-08-30',
  })
  weekEnd: string | null;

  @ApiProperty({
    type: [DashboardWeekDayDto],
    description: 'Grade de 7 dias com occurrences da timeline',
  })
  weekGrid: DashboardWeekDayDto[];

  @ApiProperty({ type: DashboardWeekProgressDto })
  weeklyProgress: DashboardWeekProgressDto;

  @ApiProperty({ example: 5 })
  harvestCount: number;

  @ApiProperty({ type: [DashboardWeekGardenLayerDto] })
  gardenLayers: DashboardWeekGardenLayerDto[];
}
