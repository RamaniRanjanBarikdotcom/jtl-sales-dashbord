import { ValidationPipe as NestValidationPipe } from '@nestjs/common';

export const validationPipe = new NestValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: false,
});
