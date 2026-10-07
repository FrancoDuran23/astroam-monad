import type { Request, Response, NextFunction } from 'express'

/**
 * Checks whether the configured FRONTEND_ORIGIN is empty or contains a wildcard '*'.
 * Used in live mode to enforce that a specific, non-wildcard origin is configured.
 */
export function isWildcardOrigin(origin: string | undefined): boolean {
  if (!origin || origin.trim() === '*' || origin.trim() === '') return true
  const list = origin.split(',').map((s) => s.trim()).filter(Boolean)
  return list.length === 0 || list.includes('*')
}

/**
 * Resolves the Access-Control-Allow-Origin header value.
 * Supports:
 * - Unset or '*': returns '*'
 * - Single origin: returns the configured origin
 * - Comma-separated list: if req.headers.origin matches one of the allowed origins,
 *   returns that origin. If not matched and no origin header was sent (e.g. non-browser / curl),
 *   falls back to the first origin. Otherwise returns null.
 */
export function resolveAllowedOrigin(rawConfig: string | undefined, incomingOrigin: string | undefined): string | null {
  if (!rawConfig || rawConfig.trim() === '*') {
    return '*'
  }
  const allowed = rawConfig.split(',').map((s) => s.trim()).filter(Boolean)
  if (allowed.length === 0 || allowed.includes('*')) {
    return '*'
  }

  if (incomingOrigin) {
    const normIncoming = incomingOrigin.replace(/\/+$/, '').toLowerCase()
    const match = allowed.find((o) => o.replace(/\/+$/, '').toLowerCase() === normIncoming)
    if (match) {
      return incomingOrigin
    }
    // Origin provided by browser but not allowed: do not emit allow-origin
    return null
  }

  // Non-CORS or tool request without Origin header: fallback to first allowed origin
  return allowed[0] ?? null
}

/**
 * Express middleware for CORS handling.
 * Emits Access-Control headers and answers OPTIONS preflights with 204.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingOrigin = req.headers.origin
  const rawOrigin = process.env.FRONTEND_ORIGIN
  const allowedOrigin = resolveAllowedOrigin(rawOrigin, incomingOrigin)

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    if (allowedOrigin !== '*') {
      res.setHeader('Vary', 'Origin')
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
}
