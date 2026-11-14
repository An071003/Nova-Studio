import pino from 'pino';

/** Structured Pino logger for the realtime server with credential/ticket redaction. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: {
    paths: [
      'password',
      'token',
      'ticket',
      'accessToken',
      'refreshToken',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    remove: true,
  },
});
