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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../auth/auth.guard';
import { WhatsAppService } from './whatsapp.service';
import { extractWebhookHeaderToken } from './whatsapp-webhook.util';
import { EvolutionClient } from './evolution.client';

@ApiTags('Evolution API')
@Controller('api/evolution')
export class EvolutionController {
  private readonly logger = new Logger(EvolutionController.name);

  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly evolution: EvolutionClient,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request, @Res() res: Response) {
    return this.handleWebhook(req, res);
  }

  @Get('status')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Status da instância Evolution API' })
  @ApiResponse({
    status: 200,
    description: 'Status atual da instância Evolution API.',
  })
  async status() {
    if (!this.evolution.isConfigured()) {
      return {
        configured: false,
        status: null,
        localWebhookUrl: this.whatsappService.getWebhookUrl(),
      };
    }

    try {
      const instanceStatus = await this.evolution.getStatus();
      return {
        configured: true,
        localWebhookUrl: this.whatsappService.getWebhookUrl(),
        subscribeEvents: this.whatsappService.getSubscribeEvents(),
        status: instanceStatus,
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
      req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'];

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
