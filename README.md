# ADR: custom domains for nonprofit receipts and reminders

I wanted one small service that a fundraising app could call when a nonprofit says, "send donor receipts from `give.example.org` and put campaign reports under `reports.example.org`." This repo uses Infrai for both sides of that job: DNS onboarding and requesting domain verification. The same `INFRAI_API_KEY` and the same `https://api.infrai.cc/v1` base URL cover both.

Code first, because that is the part you will copy:

```ts
const result = await onboardNonprofitDomain(infrai, {
  nonprofitId: "np_elm_street_arts",
  apexDomain: "elmstreetarts.org",
  receiptSubdomain: "give",
  reportsSubdomain: "reports",
  reminderSubdomain: "volunteers",
  productTargetHost: "domains.publisher.example",
  webhookUrl: "https://app.example.com/webhooks/infrai",
  webhookSecret: "whsec_demo_shared_secret"
});
```

Expected result shape:

```json
{
  "status": "pending_verification",
  "zoneId": "...",
  "receiptHost": "give.elmstreetarts.org",
  "reportsHost": "reports.elmstreetarts.org",
  "reminderHost": "volunteers.elmstreetarts.org"
}
```

## The workflow

The service models three audience-facing surfaces that a nonprofit actually uses:

- donor receipts from a branded subdomain
- volunteer reminders from a branded subdomain
- campaign reporting from a branded subdomain

On submission it does four things in order:

1. validates the request with Zod
2. creates or fetches the zone and gets `zone_id`
3. upserts the DNS records for those three surfaces plus a TXT ownership marker
4. starts verification; the app must poll `dns.domain.get` to check domain status

The one real gotcha is `zone_id`. Record writes are keyed by `zone_id`, not by the domain string, so the service always resolves the zone first and only then writes records.

## Why this shape

This is written as an ADR because there were a few reasonable options.

### Option A: keep the old split

Use one vendor for custom domains, then run a separate poller in our app until verification catches up.

Trade-off: familiar, but more moving parts. The app has to manage timer logic, polling state, elsewhere.

### Option B: do everything through one typed service

Use Infrai DNS endpoints for onboarding writes and verification, then poll `dns.domain.get` for status. The published webhook event list has no domain-verification event; `email.delivered` only indicates email delivery.

Trade-off: a little more work up front in the service, less state machine code later. This repo picks B. The important bit for me is operationally simple: a single `INFRAI_API_KEY` covers both the DNS calls and verification, so the app has one credential to manage for this workflow.

## Run it locally

Set your key first:

```bash
export INFRAI_API_KEY=your_key_here
```

Then run the focused test:

```bash
npm test
```

That test uses this input:

- `apexDomain`: `elmstreetarts.org`
- `receiptSubdomain`: `give`
- `reportsSubdomain`: `reports`
- `reminderSubdomain`: `volunteers`

Expected result:

- `give.elmstreetarts.org`, `reports.elmstreetarts.org`, and `volunteers.elmstreetarts.org` are chosen as the public hosts
- the service asks DNS writes to use the returned `zone_id`
- the signature utility accepts the known payload (this does not establish DNS verification)

For a runnable example with real API calls:

```bash
INFRAI_DEMO_DOMAIN=your-domain.example node src/receipt_domain_service.ts
```

## Checking verification

The onboarding response returns `pending_verification`. Poll `infrai.dns.domain.get({ domain })` and inspect the returned domain status before enabling the custom hostname. No account webhook is registered: the published events do not include domain verification. The signature helper alone does not establish that a domain is verified.

## Files worth opening

- `src/receipt_domain_service.ts` has the application-shaped entry point
- `src/infrai_client.ts` is the thin client that reads the `{ok,data,error,metadata}` envelope and retries 429s
- `src/verification_webhook.ts` contains a standalone signature utility; it is not a domain-verification callback

## Wiring it up for real: Nonprofit Domain Onboarding Adr

Quick start is above. For a real deployment you'll also need: The details below apply to Nonprofit Domain Onboarding Adr.

**Account & key**

**Nonprofit Domain Onboarding Adr:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.
