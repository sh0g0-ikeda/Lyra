export class AppError extends Error {
    code;
    statusCode;
    constructor(code, message, statusCode) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.name = this.constructor.name;
    }
}
export class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super('UNAUTHORIZED', message, 401);
    }
}
export class ValidationError extends AppError {
    constructor(message = 'Validation failed') {
        super('VALIDATION_ERROR', message, 422);
    }
}
export class PayloadTooLargeError extends AppError {
    constructor(message = 'Payload too large') {
        super('PAYLOAD_TOO_LARGE', message, 413);
    }
}
export class RateLimitError extends AppError {
    constructor(bucket, retryAfterSeconds) {
        super('RATE_LIMITED', `Rate limit exceeded for ${bucket}. Retry after ${retryAfterSeconds} seconds`, 429);
    }
}
export class NotFoundError extends AppError {
    constructor(message = 'Not found') {
        super('NOT_FOUND', message, 404);
    }
}
export class ForbiddenError extends AppError {
    constructor(message = 'Forbidden') {
        super('FORBIDDEN', message, 403);
    }
}
export class ConflictError extends AppError {
    constructor(message = 'Conflict') {
        super('CONFLICT', message, 409);
    }
}
export class PageStaleError extends AppError {
    constructor() {
        super('PAGE_STALE', 'The page was changed by another edit. Reload before generating.', 409);
    }
}
export class ResourceStaleError extends AppError {
    constructor() {
        super('RESOURCE_STALE', 'The resource was changed by another edit. Reload and review the latest state.', 409);
    }
}
export class InsufficientCreditsError extends AppError {
    constructor() {
        super('INSUFFICIENT_CREDITS', 'Credit balance is insufficient', 402);
    }
}
export class ConfigurationError extends AppError {
    constructor(message) {
        super('CONFIGURATION_ERROR', message, 500);
    }
}
