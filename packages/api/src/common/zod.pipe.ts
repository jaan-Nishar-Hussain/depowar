import { PipeTransform, Injectable } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { PayMeshError, ErrorCodes } from './errors';

/** Validates + coerces a request body/query against a zod schema. */
@Injectable()
export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new PayMeshError(
        ErrorCodes.VALIDATION_ERROR,
        'Request validation failed',
        'Some of the submitted data is invalid.',
        400,
        result.error.flatten(),
      );
    }
    return result.data;
  }
}