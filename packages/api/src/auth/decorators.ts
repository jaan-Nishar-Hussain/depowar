import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const SCOPES_KEY = 'scopes';

/** Marks a route as reachable without an API key. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires the API key to carry at least one of the given scopes. */
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

export interface ClientContext {
  id: string;
  scopes: string[];
}

/** Request-scoped client authenticated by the API key guard. */
export const Client = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientContext => {
  const request = ctx.switchToHttp().getRequest();
  return request.client as ClientContext;
});