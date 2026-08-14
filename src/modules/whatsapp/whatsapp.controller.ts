import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { WhatsAppService } from './whatsapp.service';
import { extractWebhookHeaderToken } from './whatsapp-webhook.util';

/** Alias legado — preferir POST /api/wuzapi/webhook */
@ApiExcludeController()
@Controller('api/whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(private readonly whatsappService: WhatsAppService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request, @Res() res: Response) {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    const signature =
      req.headers['x-hmac-signature'] || req.headers['X-HMAC-Signature'];

    const outcome = this.whatsappService.handleWebhookHttpRequest({
      body: req.body,
      rawBody,
      signatureHeader: signature,
      headerToken: extractWebhookHeaderToken(req.headers),
    });

    if (outcome.status === 401) {
      this.logger.warn(`Webhook rejeitado: ${outcome.error}`);
      return res.status(401).json({ success: false, error: outcome.error });
    }

    res.status(200).json({ success: true });
    this.whatsappService.processWebhookAsync(outcome.payload);
  }
}
