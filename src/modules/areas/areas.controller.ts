import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';

@ApiTags('Áreas')
@Controller('api/areas')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class AreasController {

  @Get()
  @ApiOperation({ summary: 'Listar áreas de foco (Conquest Types)', description: 'Retorna a lista fixa de áreas permitidas no sistema.' })
  @ApiResponse({ status: 200, description: 'Lista de áreas' })
  async getAreas() {
    return [
      { id: 'Corpo', name: 'Corpo', isActive: true, icon: 'fitness_center', color: '#ffaaaa' },
      { id: 'Mente', name: 'Mente', isActive: true, icon: 'psychology', color: '#aaaaff' },
      { id: 'Família', name: 'Família', isActive: true, icon: 'family_restroom', color: '#ffffaa' },
      { id: 'Trabalho', name: 'Trabalho', isActive: true, icon: 'work', color: '#ffaaff' },
      { id: 'Social', name: 'Social', isActive: true, icon: 'groups', color: '#aaffff' },
      { id: 'Saúde', name: 'Saúde', isActive: true, icon: 'health_and_safety', color: '#aaffaa' },
      { id: 'Espiritual', name: 'Espiritual', isActive: true, icon: 'self_improvement', color: '#ffd4aa' },
      { id: 'Financeiro', name: 'Financeiro', isActive: true, icon: 'attach_money', color: '#cae6c2' },
      { id: 'Hobby', name: 'Hobby', isActive: true, icon: 'palette', color: '#f7d1f5' },
    ];
  }
}
