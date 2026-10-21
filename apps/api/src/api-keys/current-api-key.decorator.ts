import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { OpenApiKey, OpenApiRequest } from './api-key.guard';

export const CurrentApiKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OpenApiKey => {
    const request = context.switchToHttp().getRequest<OpenApiRequest>();
    return request.apiKey!;
  },
);
