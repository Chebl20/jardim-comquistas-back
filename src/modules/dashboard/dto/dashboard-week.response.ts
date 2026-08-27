import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DashboardWeekGoalDto {
  @ApiProperty({ description: 'ID da meta', format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Título da meta', example: 'Beber água' })
  title: string;

  @ApiProperty({ description: 'Área de conquista', example: 'Corpo' })
  conquestType: string;

  @ApiProperty({
    description: 'Quantidade de lembretes agendados neste dia',
    example: 1,
  })
  slots: number;

  @ApiProperty({
    description: 'Horários agendados no dia (HH:mm, fuso do usuário)',
    example: ['08:00'],
    type: [String],
  })
  times: string[];
}

export class DashboardWeekDayDto {
  @ApiProperty({ description: 'Data do dia (ISO)', example: '2026-08-26' })
  date: string | null;

  @ApiProperty({ description: 'Total de slots esperados no dia', example: 4 })
  expectedSlots: number;

  @ApiProperty({ description: 'Colheitas registradas no dia', example: 0 })
  harvestCount: number;

  @ApiProperty({ type: [DashboardWeekGoalDto] })
  goals: DashboardWeekGoalDto[];
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
  @ApiProperty({ description: 'Data base informada na query', example: '2026-08-26' })
  date: string | null;

  @ApiPropertyOptional({ description: 'Filtro de área', example: 'Corpo', nullable: true })
  areaId: string | null;

  @ApiProperty({ description: 'Início da semana (segunda)', example: '2026-08-24' })
  weekStart: string | null;

  @ApiProperty({ description: 'Fim da semana (domingo)', example: '2026-08-30' })
  weekEnd: string | null;

  @ApiProperty({ type: [DashboardWeekDayDto], description: 'Grade de 7 dias com metas e horários' })
  weekGrid: DashboardWeekDayDto[];

  @ApiProperty({ type: DashboardWeekProgressDto })
  weeklyProgress: DashboardWeekProgressDto;

  @ApiProperty({ example: 5 })
  harvestCount: number;

  @ApiProperty({ type: [DashboardWeekGardenLayerDto] })
  gardenLayers: DashboardWeekGardenLayerDto[];
}
