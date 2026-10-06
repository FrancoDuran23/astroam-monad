import type { ConnectivityProvider } from '../providers/connectivity/ConnectivityProvider.ts'

export class ResellerInsufficientFundsError extends Error {
  readonly code = 'RESELLER_INSUFFICIENT_FUNDS'
  readonly statusCode = 503
  readonly balanceUsd: number
  readonly requiredUsd: number

  constructor(balanceUsd: number, requiredUsd: number, message?: string) {
    const defaultMsg = `RESELLER_INSUFFICIENT_FUNDS: Saldo operativo de reseller insuficiente ($${balanceUsd.toFixed(2)} USD < $${requiredUsd.toFixed(2)} USD requeridos)`
    super(message ?? defaultMsg)
    this.name = 'ResellerInsufficientFundsError'
    this.balanceUsd = balanceUsd
    this.requiredUsd = requiredUsd
  }
}

/**
 * Computes the minimum required reseller balance in USD:
 * (provisionCents + trancheCents) / 100.
 *
 * Defaults:
 * - provisionCents = 175 ($1.75 USD)
 * - trancheCents = 250 ($2.50 USD)
 */
export function getMinRequiredResellerBalanceUsd(): number {
  const rawProvision = process.env.CITRUS_ESIM_PROVISION_CENTS
  const rawTranche = process.env.FUNDING_TRANCHE_CENTS

  const provisionCents = rawProvision !== undefined ? parseInt(rawProvision, 10) : 175
  const trancheCents = rawTranche !== undefined ? parseInt(rawTranche, 10) : 250

  const validProvision = Number.isFinite(provisionCents) && provisionCents >= 0 ? provisionCents : 175
  const validTranche = Number.isFinite(trancheCents) && trancheCents >= 0 ? trancheCents : 250

  return (validProvision + validTranche) / 100
}

/**
 * Validates that the connectivity provider has sufficient reseller balance
 * to provision an eSIM and fund its initial tranche.
 *
 * Throws ResellerInsufficientFundsError if balance.balanceUsd < requiredUsd.
 */
export async function assertSufficientResellerBalance(
  connectivity: ConnectivityProvider,
): Promise<{ balanceUsd: number; requiredUsd: number }> {
  const balance = await connectivity.getResellerBalance()
  const requiredUsd = getMinRequiredResellerBalanceUsd()

  if (balance.balanceUsd < requiredUsd) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        reason: 'citrus_reseller_insufficient_funds',
        balanceUsd: balance.balanceUsd,
        requiredUsd,
      }),
    )
    throw new ResellerInsufficientFundsError(balance.balanceUsd, requiredUsd)
  }

  return { balanceUsd: balance.balanceUsd, requiredUsd }
}
