import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateGrowthEventDto {
  @IsOptional()
  @IsUUID()
  treeCatalogId?: string;

  @IsOptional()
  @IsString()
  family?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  anchorId?: string;
}