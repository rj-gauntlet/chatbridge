import type { NextFunction, Request, Response } from 'express'

export interface AppError extends Error {
  statusCode?: number
  code?: string
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode || 500
  const message = err.message || 'Internal server error'

  if (statusCode >= 500) {
    console.error('[ERROR]', err)
  }

  res.status(statusCode).json({
    error: message,
    code: err.code,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
}

export function createError(message: string, statusCode = 500, code?: string): AppError {
  const err: AppError = new Error(message)
  err.statusCode = statusCode
  err.code = code
  return err
}
