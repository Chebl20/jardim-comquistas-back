import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { listConquestAreas } from '../shared/area-visual.util';

@ApiTags('Áreas')
@Controller('api/areas')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class AreasController {
  @Get()
  @ApiOperation({
    summary: 'Listar áreas de foco (Conquest Types)',
    description:
      'Retorna as áreas oficiais, com o ícone e a cor padrão de cada uma.',
  })
  @ApiResponse({ status: 200, description: 'Lista de áreas' })
  async getAreas() {
    return listConquestAreas();
  }
}
