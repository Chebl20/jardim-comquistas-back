import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGrowthEventDto {
  @ApiPropertyOptional({
    description: 'ID do catálogo de árvore',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  treeCatalogId?: string;

  @ApiPropertyOptional({
    description: 'Família da árvore',
    example: 'carvalho',
  })
  @IsOptional()
  @IsString()
  family?: string;

  @ApiPropertyOptional({ description: 'Título da meta' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Descrição da meta' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'ID do anchor onde plantar' })
  @IsOptional()
  @IsString()
  anchorId?: string;

  @ApiPropertyOptional({
    description: 'Tipo de meta (ex: daily, weekly)',
    example: 'daily',
  })
  @IsOptional()
  @IsString()
  goalType?: string;

  @ApiPropertyOptional({ description: 'Frequência da meta', example: 'daily' })
  @IsOptional()
  @IsString()
  frequency?: string;
}
