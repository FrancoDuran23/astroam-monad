/**
 * How a payment is handled. Outside explicit demo mode a payment is always a
 * transaction sent from the wallet; nothing is ever simulated or typed by hand.
 */
export type PaymentMode = 'simulated' | 'blocked' | 'on-chain'

export const PAYMENTS_UNAVAILABLE_TITLE = 'Payments are not available'
export const PAYMENTS_UNAVAILABLE_MESSAGE =
  'This server cannot take payments right now. Nothing was charged. Try again later or contact the AstroAm team.'

export function paymentMode(
  isDemoMode: boolean,
  caps: { paymentsLive: boolean } | null | undefined,
  intent?: { evm?: unknown } | null,
): PaymentMode {
  if (isDemoMode) return 'simulated'
  if (!caps || caps.paymentsLive !== true) return 'blocked'
  if (intent && !intent.evm) return 'blocked'
  return 'on-chain'
}

/** The "USE 5 MB" button: always in demo mode, otherwise unless the server turns it off. */
export function showDemoTraffic(isDemoMode: boolean, caps: { demoTrafficEnabled?: boolean } | null | undefined): boolean {
  return isDemoMode || caps?.demoTrafficEnabled !== false
}
