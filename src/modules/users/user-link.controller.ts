import { Controller, Post, Body } from '@nestjs/common';
import { UserLinkService } from './user-link.service';

@Controller('api/users/link')
export class UserLinkController {
  constructor(private readonly userLinkService: UserLinkService) {}

  @Post('generate')
  async generate(@Body() body: { userId: string }) {
    const code = await this.userLinkService.generateLinkCode(body.userId);
    return { linkCode: code };
  }

  @Post('telegram')
  async linkTelegram(@Body() body: { linkCode: string; telegramId: string }) {
    const user = await this.userLinkService.linkTelegram(body.linkCode, body.telegramId);
    return { ok: true, userId: user.id };
  }
}
