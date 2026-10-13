# OMRAN staging-only approval gate

This isolated folder is the first, **offline and non-deploying** component of
the v3 OMRAN product review design. It does not connect to Cloudflare, the live
store, GitHub's production deployment workflow, or any payment/checkout system.

## Verified deployment boundary

- Live OMRAN storefront: `alaaomran2020/omran-store-live` → `omrantoys-live-app`.
- Live product source: `public/catalog/products.csv`, compiled into the Vite snapshot.
- This repo is **not** authorized to replace that public product source.
- Cloudflare's separate `omran-automation-staging` Worker and
  `omran-toys-admin-staging` Pages project are not automatically deployed
  by this PR.
- Production never changes through this workflow.

## Contract

`evaluateStagingPreview(input)` is a pure fail-closed check. All must hold:

1. `environment === "staging"`; explicit `autoPublishEnabled:false` and
   `productionWritesEnabled:false`.
2. The acting publisher has an authorized role and is distinct from human
   price and safety reviewers.
3. Product is `READY_FOR_STAGING`, with SKU, Arabic title, valid age range.
4. Positive human-approved price with reviewer ID.
5. Recorded human safety approval and nonempty evidence references; relevant
   Arabic warnings must be present.
6. At least one verified staging media key with a local staging-only prefix.

`createStagingPreview` emits only an allowlisted *preview* payload,
never approval metadata, supplier costs, tokens, hidden drafts or publish
requests. There is no external API write.

**Important:** This pure function does not authenticate HTTP requests, verify
documents, authorize Cloudflare Access JWTs, or prove that certifications
are genuine. A separate protected Worker API, Access validation, database
constraints and manual review must be implemented and tested before any real
staging integration. Do not deploy this module as a public endpoint.

## Test

```bash
node --test staging-ops/approvalGate.test.mjs
```

The isolated GitHub Action `omran-staging-approval-gate.yml` runs only tests
and refuses release commands. No production/preview deployment step exists.

## Next required actions (not completed here)

- Secure Cloudflare Access server-side verification and role scopes.
- Add staging D1 migration, event/idempotency ledger, and validated endpoints.
- Configure admin API secret with Cloudflare secret management; never commit it.
- Authorize Drive independently for staging media intake or use restricted R2.
- Publish a working isolated admin Pages build to Staging after review.
- Implement a human-reviewed catalog CSV/media PR release bridge; do not
  directly write to the live storefront.
