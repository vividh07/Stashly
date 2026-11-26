export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(message: string, details?: unknown) {
  return new AppError(400, message, 'bad_request', details);
}

export function unauthorized(message = 'Unauthorized') {
  return new AppError(401, message, 'unauthorized');
}

export function forbidden(message = 'Forbidden') {
  return new AppError(403, message, 'forbidden');
}

export function notFound(message = 'Not found') {
  return new AppError(404, message, 'not_found');
}

export function conflict(message: string, details?: unknown) {
  return new AppError(409, message, 'conflict', details);
}

export function tooMany(message = 'Too many requests') {
  return new AppError(429, message, 'rate_limited');
}

export function payloadTooLarge(message: string) {
  return new AppError(413, message, 'payload_too_large');
}

export function quotaExceeded(message = 'Storage quota exceeded') {
  return new AppError(413, message, 'quota_exceeded');
}

export function serverError(message = 'Internal server error') {
  return new AppError(500, message, 'internal');
}
