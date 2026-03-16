import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Habilita CORS em desenvolvimento para o frontend consumir o SVG
  app.enableCors();

  // Habilita validação automática de DTOs
  app.useGlobalPipes(new ValidationPipe());

  await app.listen(3000);
}
bootstrap();
