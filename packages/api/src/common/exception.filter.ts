import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ZodError } from 'zod';
import { PayMeshError, ErrorCodes } from './errors';
import { PayMeshRoutingError } from '@paymesh/routing-engine';
import { stringifyBigInts } from './serialize';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCodes.INTERNAL_ERROR;
    let message = 'Unexpected server error';
    let userMessage = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof PayMeshError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      userMessage = exception.userMessage;
      details = exception.details;
    } else if (exception instanceof PayMeshRoutingError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = exception.code;
      message = exception.message;
      userMessage = 'No executable route is currently available for this asset pair. Try again shortly.';
      details = exception.details;
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCodes.VALIDATION_ERROR;
      message = 'Request validation failed';
      userMessage = 'Some of the submitted data is invalid.';
      details = exception.flatten();
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const bodyMessage = (body as { message?: unknown }).message;
        if (typeof bodyMessage === 'string') userMessage = bodyMessage;
      }
    }

    const prismaError = exception as { name?: string; code?: string };
    if (prismaError?.name === 'PrismaClientKnownRequestError') {
      status = HttpStatus.CONFLICT;
      code = ErrorCodes.DATABASE_CONFLICT;
      userMessage = 'The request conflicts with existing data.';
      details = { dbCode: prismaError.code };
    }

    this.logger.error(
      JSON.stringify({
        requestId: request.requestId,
        code,
        message,
        path: request.url,
        cause: exception instanceof Error ? `${exception.name}: ${exception.message}\n${exception.stack}` : String(exception),
      }),
    );

    response.status(status).json(stringifyBigInts({
      error: { code, message, userMessage, details },
      requestId: request.requestId,
    }));
  }
}
