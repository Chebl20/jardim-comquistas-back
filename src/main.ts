import { webcrypto } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppLogger } from './logging/app-logger';

// Polyfill para crypto global em Node.js
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as any;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: new AppLogger(),
  });
  // Habilita CORS em desenvolvimento para o frontend consumir o SVG
  app.enableCors();

  // Habilita validação automática de DTOs
  app.useGlobalPipes(new ValidationPipe());

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('Jardim das Conquistas API')
    .setDescription('API do backend do Jardim das Conquistas — gerenciamento de metas, mundos, árvores e integração com Telegram/WhatsApp.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(3000);
}
bootstrap();

