import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

/**
 * Typed error hierarchy for Itqan
 * All errors extend ItqanError with code and HTTP status
 */

export class ItqanError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends ItqanError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class NotFoundError extends ItqanError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404, { resource, id });
  }
}

export class UnauthorizedError extends ItqanError {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends ItqanError {
  constructor(message = 'Forbidden') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class ConflictError extends ItqanError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, details);
  }
}

export class RateLimitError extends ItqanError {
  constructor(retryAfter: number) {
    super('Rate limit exceeded', 'RATE_LIMITED', 429, { retryAfter });
  }
}

export class UpstreamError extends ItqanError {
  constructor(service: string, message: string) {
    super(`Upstream service error: ${service} - ${message}`, 'UPSTREAM_ERROR', 502, { service });
  }
}

export class ContentReviewRequiredError extends ItqanError {
  constructor(contentType: string, contentId: string) {
    super(
      `Content requires scholarly review before publication`,
      'CONTENT_REVIEW_REQUIRED',
      403,
      { contentType, contentId }
    );
  }
}

export class ConsentRequiredError extends ItqanError {
  constructor(purpose: string) {
    super(`Consent required for: ${purpose}`, 'CONSENT_REQUIRED', 403, { purpose });
  }
}

export class AudioRetentionError extends ItqanError {
  constructor(message: string) {
    super(message, 'AUDIO_RETENTION_ERROR', 400);
  }
}

export class SchedulerError extends ItqanError {
  constructor(message: string) {
    super(message, 'SCHEDULER_ERROR', 500);
  }
}

export class ASRError extends ItqanError {
  constructor(message: string, engine: 'tarteel' | 'whisper') {
    super(message, 'ASR_ERROR', 502, { engine });
  }
}

export class ContentApprovalError extends ItqanError {
  constructor(message: string) {
    super(message, 'CONTENT_APPROVAL_ERROR', 403);
  }
}

/**
 * Zod validation error formatter
 */
export function formatZodError(error: z.ZodError): ValidationError {
  const issues = error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
  
  return new ValidationError(
    'Request validation failed',
    { issues }
  );
}

/**
 * Global error handler for Fastify
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const requestId = request.id;
  const timestamp = new Date().toISOString();

  // Log error
  request.log.error({
    err: error,
    requestId,
    url: request.url,
    method: request.method,
    ip: request.ip,
  }, 'Request error');

  // ItqanError - return structured response
  if (error instanceof ItqanError) {
    return reply.code(error.status).send({
      type: `https://itqan.link/errors/${error.code.toLowerCase()}`,
      title: error.name,
      status: error.status,
      detail: error.message,
      instance: request.url,
      code: error.code,
      details: error.details,
    });
  }

  // Zod validation error
  if (error instanceof z.ZodError) {
    const validationError = formatZodError(error);
    return reply.code(validationError.status).send({
      type: `https://itqan.link/errors/validation_error`,
      title: 'Validation Error',
      status: validationError.status,
      detail: validationError.message,
      instance: request.url,
      code: validationError.code,
      details: validationError.details,
    });
  }

  // Fastify validation error
  if (error.validation) {
    return reply.code(400).send({
      type: 'https://itqan.link/errors/validation_error',
      title: 'Validation Error',
      status: 400,
      detail: 'Request validation failed',
      instance: request.url,
      code: 'VALIDATION_ERROR',
      details: { issues: error.validation },
    });
  }

  // Rate limit error
  if (error.statusCode === 429) {
    return reply.code(429).send({
      type: 'https://itqan.link/errors/rate_limited',
      title: 'Rate Limited',
      status: 429,
      detail: 'Too many requests, please try again later',
      instance: request.url,
      code: 'RATE_LIMITED',
    });
  }

  // Generic error
  const statusCode = error.statusCode || 500;
  
  return reply.code(statusCode).send({
    type: 'https://itqan.link/errors/internal_server_error',
    title: 'Internal Server Error',
    status: statusCode,
    detail: config.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
    instance: request.url,
    code: 'INTERNAL_ERROR',
  });
}

// Import config at bottom to avoid circular dependency
import { config } from '../config';