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

    const validation = this.whatsappService.validateWebhookRequest({
      body: req.body,
      rawBody,
      signatureHeader: signature,
    });

    if (!validation.ok) {
      this.logger.warn(`Webhook rejeitado: ${validation.reason}`);
      return res.status(401).json({ success: false, error: validation.reason });
    }

    // Ack rápido para evitar retries da WUZAPI enquanto a IA processa
    res.status(200).json({ success: true });
    this.whatsappService.processWebhookAsync(validation.payload);
  }
}
