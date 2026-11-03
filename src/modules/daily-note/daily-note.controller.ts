import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { DailyNoteService } from './daily-note.service';

@ApiTags('Usuários')
@Controller('api/users/me/daily-note')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class DailyNoteController {
  constructor(private readonly dailyNoteService: DailyNoteService) {}

  @Get()
  @ApiOperation({
    summary: 'Recados do dia',
    description:
      'Reflexão e cuidado de hoje, no fuso da pessoa. Gera uma vez por dia civil e reaproveita o registro nas leituras seguintes.',
  })
  @ApiResponse({ status: 200, description: 'Frases de hoje. care pode ser null.' })
  getToday(@Req() req: { user: { userId: string } }) {
    return this.dailyNoteService.getToday(req.user.userId);
  }
}
