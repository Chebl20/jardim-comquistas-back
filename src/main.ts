import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Habilita CORS em desenvolvimento para o frontend consumir o SVG
  app.enableCors();

  await app.listen(3000);
}
bootstrap();
