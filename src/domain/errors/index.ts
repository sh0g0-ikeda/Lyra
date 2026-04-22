import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class AppError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UnauthorizedError extends AppError {
  public constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ValidationError extends AppError {
  public constructor(message = 'Validation failed') {
    super('VALIDATION_ERROR', message, 422);
  }
}

export class NotFoundError extends AppError {
  public constructor(message = 'Not found') {
    super('NOT_FOUND', message, 404);
  }
}

export class InsufficientCreditsError extends AppError {
  public constructor() {
    super('INSUFFICIENT_CREDITS', 'Credit balance is insufficient', 402);
  }
}

export class ConfigurationError extends AppError {
  public constructor(message: string) {
    super('CONFIGURATION_ERROR', message, 500);
  }
}
