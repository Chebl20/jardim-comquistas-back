import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ProgressPlantedTreeDto {
  @IsOptional()
  @IsUUID()
  plantedTreeId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;
}