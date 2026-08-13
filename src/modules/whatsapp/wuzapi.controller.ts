import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  HttpCode,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../auth/auth.guard';
import { WhatsAppService } from './whatsapp.service';
import { WuzapiClient } from './wuzapi.client';

@ApiTags('WUZAPI')
@Controller('api/wuzapi')
export class WuzapiController {
  private readonly logger = new Logger(WuzapiController.name);

  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly wuzapi: WuzapiClient,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request, @Res() res: Response) {
    return this.handleWebhook(req, res);
  }

  @Get('status')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Status do webhook WUZAPI na instância' })
  @ApiResponse({ status: 200, description: 'Configuração atual do webhook na WUZAPI.' })
  async status() {
    if (!this.wuzapi.isConfigured()) {
      return { configured: false, webhook: null, localWebhookUrl: this.whatsappService.getWebhookUrl() };
    }

    try {
      const webhook = await this.wuzapi.getWebhook();
      return {
        configured: true,
        localWebhookUrl: this.whatsappService.getWebhookUrl(),
        subscribeEvents: this.whatsappService.getSubscribeEvents(),
        webhook,
      };
    } catch (e) {
      return {
        configured: true,
        localWebhookUrl: this.whatsappService.getWebhookUrl(),
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private handleWebhook(req: Request, res: Response) {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    const signature =
      req.headers['x-hmac-signature'] || req.headers['X-HMAC-Signature'];

    const outcome = this.whatsappService.handleWebhookHttpRequest({
      body: req.body,
      rawBody,
      signatureHeader: signature,
    });

    if (outcome.status === 401) {
      this.logger.warn(`Webhook rejeitado: ${outcome.error}`);
      return res.status(401).json({ success: false, error: outcome.error });
    }

    res.status(200).json({ success: true });
    this.whatsappService.processWebhookAsync(outcome.payload);
  }
}
