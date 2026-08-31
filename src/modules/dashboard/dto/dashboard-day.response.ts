import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DashboardDayGoalDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Beber água' })
  title: string;

  @ApiProperty({ example: 'Corpo' })
  conquestType: string;

  @ApiPropertyOptional({
    description:
      'Status contextual à date consultada (não o GoalReminder global). ' +
      'CONTINUA+DAILY: DONE só no dia em que houve conclusão; demais dias PENDING.',
    example: null,
    nullable: true,
  })
  dailyStatus: string | null;

  @ApiPropertyOptional({
    description: 'Agendamento reconstruído da meta (times, at, daysOfWeek, etc.)',
  })
  scheduleConfig?: Record<string, unknown> | null;
}

export class DashboardDayResponseDto {
  @ApiProperty({ example: '2026-08-27' })
  date: string;

  @ApiPropertyOptional({ nullable: true })
  areaId: string | null;

  @ApiProperty({
    type: [DashboardDayGoalDto],
    description: 'Metas agendadas para o dia; dailyStatus reflete a date da query.',
  })
  goals: DashboardDayGoalDto[];

  @ApiProperty({ example: 'Resumo do dia' })
  summary: string;
}
