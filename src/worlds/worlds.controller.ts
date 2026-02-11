import { Controller } from '@nestjs/common';

// Routes moved to specialized controllers in src/worlds/*.controller.ts
@Controller('api/worlds')
export class WorldsController {}
