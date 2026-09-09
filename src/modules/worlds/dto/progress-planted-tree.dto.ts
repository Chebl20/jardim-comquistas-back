import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ProgressPlantedTreeDto {
  @ApiPropertyOptional({ description: 'ID da árvore plantada', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  plantedTreeId?: string;

  @ApiPropertyOptional({ description: 'Título do progresso' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Descrição do progresso' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Mensagem do usuário' })
  @IsOptional()
  @IsString()
  userMessage?: string;
}
