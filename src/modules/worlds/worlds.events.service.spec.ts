import { BadRequestException } from '@nestjs/common';
import { WorldsEventsService } from './worlds.events.service';

describe('WorldsEventsService.createGrowthEventByCatalog', () => {
  it('não planta nem cria Goal — aponta para POST /api/goals', async () => {
    const service = new WorldsEventsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.createGrowthEventByCatalog('world-1', {
        userId: 'user-user-1',
        family: 'a',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
