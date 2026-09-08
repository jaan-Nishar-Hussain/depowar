import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const SCOPES_KEY = 'scopes';

/** Marks a route as reachable without an API key. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires the API key to carry at least one of the given scopes. */
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

/** The authenticated project (scoping unit for keys/receivers/deposits). */
export interface ProjectContext {
  id: string;
  scopes: string[];
}

export interface UserContext { id: string; email: string; }

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserContext => {
  const request = ctx.switchToHttp().getRequest();
  return request.user as UserContext;
});

/** Request-scoped project authenticated by the API key guard (Project-first). */
export const Project = createParamDecorator((_data: unknown, ctx: ExecutionContext): ProjectContext => {
  const request = ctx.switchToHttp().getRequest();
  return request.project as ProjectContext;
});