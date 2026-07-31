# Design: billing and invoicing

**Status: not built.** Salvaged from QwixPBX v1, which had the schema and a `billing.go` but no
working feature — despite its roadmap marking billing complete.

Today the system records calls (`cdr` in `portal/api/src/db/schema.ts`) and nothing rates them.

## Shape

Five concerns, in dependency order:

1. **Rates** — what a destination costs.
2. **Usage** — what was actually consumed, derived from CDR.
3. **Account** — a tenant's balance, credit limit and billing details.
4. **Invoice** — a periodic statement built from usage.
5. **Payment** — money received against an invoice.

### Rates

- `rateCard` — `(name, description, currency, defaultRate)`.
- `rateCardRate` — `(rateCardId, prefix, destinationName, ratePerMinute, setupFee, minDurationSec,
  incrementSec, effectiveStartDate, effectiveEndDate)`.
- `tenantRateCard` — `(organizationId, rateCardId, type: outbound|inbound, priority)`.

Two properties this design gets right and that are easy to lose:

- **Rating is longest-prefix match**, not equality. `1416` must beat `1` for a Toronto number.
  Index on `(rateCardId, prefix)` and match by descending prefix length.
- **`minDurationSec` and `incrementSec` are per-rate, not global.** Carriers bill 60/60, 30/6, 1/1
  depending on the route, and a single global rounding rule silently misprices everything the
  moment you add a second carrier.

`effectiveStartDate`/`effectiveEndDate` mean a rate lookup is always "the rate in force at the time
of the call", never "the current rate". Rating a three-week-old CDR with today's card is a
correctness bug that looks like a rounding error.

### Usage

- `usageRecord` — `(organizationId, billingAccountId, cdrId?, type, description, quantity, unit,
  rate, totalCost, startTime, endTime, invoiceId?)`.

`type` is deliberately broader than calls: v1 lists `call, did_rental, extension_seat,
recording_storage, sms`. Recurring charges and metered non-call usage go through the same table, so
an invoice is one query.

`cdrId` is nullable for exactly that reason — a DID rental has no call behind it.

### Account, invoice, payment

- `billingAccount` — `(organizationId, accountType: prepaid|postpaid, currency, balance,
  creditLimit, billingCycleAnchor, taxId, billingEmail, billingAddress jsonb, status,
  stripeCustomerId, paypalPayerId)`.
- `invoice` — `(billingAccountId, invoiceNumber, startDate, endDate, issueDate, dueDate, subtotal,
  taxAmount, totalAmount, balanceDue, status: draft|posted|paid|void|overdue, pdfUrl)`.
- `invoiceItem` — `(invoiceId, description, quantity, unitPrice, amount, taxable, usageRecordId?)`.
- `payment` — `(billingAccountId, invoiceId?, amount, currency, method, transactionId, status,
  paymentDate)`.
- `paymentMethod` — `(billingAccountId, provider, providerToken, type)`.
- `balanceHistory` — append-only ledger of balance movements.

## Things to get right

**Money is `numeric`, never `real` or `double`.** v1 used `DECIMAL(12,4)` for rates and balances
and `DECIMAL(12,2)` for invoice totals; the drizzle equivalent is `numeric` with explicit precision
and scale. Floating point money produces balances that are off by fractions of a cent and cannot be
reconciled. Four decimal places on rates matters — per-minute rates are routinely $0.0035.

**Prepaid is a real-time concern, postpaid is a batch one.** A prepaid account with `balance` and
`creditLimit` has to be checked *during call setup* and the call cut when credit runs out, which
means the balance must be reachable from the call path — i.e. cached in Redis alongside the other
tenant data, with the key shape registered in `keys.tenantPatterns`
(`portal/api/src/services/redis.ts`). Postpaid only needs a nightly job. Deciding you support both
means building both paths; `MAX_CONCURRENT_CALLS` in `config.env.example` is the existing crude
defence against toll fraud, and real-time credit control is the proper one.

**Never store card details.** `paymentMethod.providerToken` holds a Stripe `payment_method_id` or a
PayPal token — an opaque reference. Storing a PAN puts the whole system in PCI-DSS scope. v1 got
this right; keep it that way.

**Invoice numbers are sequential and gapless** in most jurisdictions. That is a database sequence
with a per-tenant series, not `count(*) + 1`, and it must survive a rolled-back transaction without
reusing a number.

## Where it plugs in

- Rating consumes `cdr` rows. `portal/api/src/services/cdr.ts` already ingests them; rating should
  be a separate pass so a rating bug never blocks CDR capture.
- Routes go through `crudRoutes` with a `permission` — billing data is the most sensitive
  non-credential data in the system, and a `viewer` must not see another tenant's invoices.
  Cross-tenant reads here are a breach, not a bug.
- Invoice PDFs are files; `pdfUrl` implies storage with authenticated access, not a public URL.
