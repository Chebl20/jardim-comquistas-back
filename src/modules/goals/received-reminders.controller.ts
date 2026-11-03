import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { UserGoalService } from './user-goal.service';

@ApiTags('Usuários')
@Controller('api/users/me/reminders')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class ReceivedRemindersController {
  constructor(private readonly userGoalService: UserGoalService) {}

  @Get()
  @ApiOperation({
    summary: 'Lembretes recebidos nos últimos 7 dias',
    description:
      'Um item por meta, o último lembrete, se o envio foi nos últimos 7 dias. A janela é corrida. Não inclui conversa nem resumo diário.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista dos últimos 7 dias, do mais recente ao mais antigo.',
  })
  getRecent(@Req() req: { user: { userId: string } }) {
    return this.userGoalService.getReceivedReminders(req.user.userId);
  }
}
