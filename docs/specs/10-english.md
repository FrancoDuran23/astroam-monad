# 10 — English everywhere

Runs last: it renames and rewrites files every other spec touches.

## Why

astroam-solana is entirely in English. astroam-monad still has most of
`docs/` in Spanish, Spanish file names, and Spanish comments, test names and
messages in the code.

## Scope

The whole repository except `docs/specs/`, `package-lock.json` files and
`design-reference/`.

## Requirements

1. **File names.** Rename with `git mv` so history follows. Use
   astroam-solana's name where a counterpart exists:

   | From | To |
   |---|---|
   | `docs/decisiones/medicion-con-proveedor.md` | `docs/decisions/metering-with-provider.md` |
   | `docs/arquitectura-flujo-de-fondos.md` | `docs/decisions/fund-flow-architecture.md` |
   | `docs/issues-flujo-de-fondos.md` | `docs/decisions/automate-fund-flow-issues.md` |
   | `docs/despliegues-monad.md` | `docs/monad-deployments.md` |
   | `docs/reporte-prueba-e2e-monad.md` | `docs/monad-e2e-test-report.md` |
   | `docs/plan-reembolso-y-misiones-huerfanas.md` | `docs/refund-and-orphan-missions-plan.md` |
   | `docs/pruebas-mobile-metamask.md` | `docs/mobile-metamask-testing.md` |
   | `docs/guion-video-demo.md` | `docs/demo-video-script.md` |

   Rename any other Spanish file name found the same way.
2. **Documents.** Translate the content of every Spanish document. Keep the
   meaning, the numbers, the addresses, the transaction hashes, the dates and
   the code blocks exactly. Do not summarize or drop sections.
3. **Links.** Update every reference to a renamed file: README, other
   documents, code comments, `.env.example`, scripts' usage text.
4. **Code.** Translate Spanish comments, test names, log messages, error
   messages and API `detail` strings under `src/`, `scripts/`, `contracts/`
   and `frontend/src/`. Where a test asserts on a message that changes,
   change both together. Do not change behaviour, identifiers used across
   files, HTTP status codes or reason codes.
5. **User-facing copy** in the frontend is already English; fix any Spanish
   that remains.
6. Text that is legitimately in another language stays: place names,
   people's names, quoted interview answers and their sources.

## Done when

- `npm run check` and `npm test` pass at the root; `npm run typecheck`,
  `npm test` and `npm run build` pass in `frontend/`;
  `forge test --root contracts` passes. Test counts equal the counts before
  this spec.
- `git ls-files docs | grep -iE "decisiones|arquitectura|despliegues|reporte|pruebas|guion|plan-reembolso|flujo"`
  returns nothing.
- `grep -rnP "[áéíóúñ¿¡]" src scripts contracts frontend/src` returns only
  lines covered by requirement 6, each listed in the report.
- A link check over `README.md` and `docs/**/*.md` finds no broken relative
  link.
