import { z } from 'zod'

export const destinationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  flag: z.string().min(1),
  network: z.string().min(1),
  coverage: z.string().min(1),
  pricePerMbUsdc: z.number().positive(),
})

export const createMissionSchema = z.object({
  userId: z.string().optional().default('usr_demo'),
  destination: destinationSchema,
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  budgetUsdc: z.number().positive(),
  dailyLimitUsdc: z.number().positive(),
  autoPause: z.boolean().optional().default(true),
  lowBalanceAlert: z.boolean().optional().default(true),
})

export const paymentConfirmationSchema = z.object({
  intentId: z.string().min(1),
  txHash: z.string().min(1),
})

export const topupIntentSchema = z.object({
  amountUsdc: z.number().positive(),
})

export const topupConfirmationSchema = z.object({
  intentId: z.string().min(1),
  txHash: z.string().min(1),
})

export const authorizationSchema = z.object({
  /** Running total authorized, in token units, exactly as signed. */
  cumulativeAmount: z.string().regex(/^(0|[1-9]\d*)$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
})

export const demoTrafficSchema = z.object({
  bytes: z.number().positive(),
})
