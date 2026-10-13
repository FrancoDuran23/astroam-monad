import { PAYMENTS_UNAVAILABLE_MESSAGE, PAYMENTS_UNAVAILABLE_TITLE } from '../../utils/paymentMode'

/** Blocking notice for a payment step that cannot go on chain. The action behind it stays disabled. */
export default function PaymentsUnavailable() {
  return (
    <div role="alert" className="flex items-start gap-3 p-4 rounded-2xl bg-alerta/10 border border-alerta/40">
      <span className="material-symbols-outlined text-xl text-alerta shrink-0" aria-hidden="true">block</span>
      <div>
        <p className="font-display text-base font-bold text-textprimary">{PAYMENTS_UNAVAILABLE_TITLE}</p>
        <p className="mt-1 text-sm text-textsecondary leading-relaxed">{PAYMENTS_UNAVAILABLE_MESSAGE}</p>
      </div>
    </div>
  )
}
