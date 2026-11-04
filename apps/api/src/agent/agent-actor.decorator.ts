import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AgentActorRequest } from './agent-auth.guard';

export const AgentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AgentActorRequest>();
    return req.agentActor!;
  },
);
