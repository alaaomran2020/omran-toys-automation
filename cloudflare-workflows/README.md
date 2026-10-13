# OMRAN Cloudflare Workflows — Independent Staging

This is a separate Cloudflare Worker + Workflows + D1 implementation. It does not change the legacy Node/Fastify service at repository root, the production store, or its database.

## Status
- Staging intake, independent database, durable queue, admin decisions, draft editing, audit and preview workflow.
- No production publishing. No GitHub writes. No store API requests. Approved catalog entries stay STAGED_ONLY in D1.
- Image processing remains **manual**. Incoming Telegram photos store file references only; no image downloads. No Gemini or Google Drive integration yet.
- Telegram and admin ingress **fail closed** until secure secrets are configured. Deployment does not register Telegram webhooks.

## Deployment
- Worker: omran-automation-staging
- Database: omran-automation-staging-db
- Workflows: omran-intake-staging and omran-catalog-preview-staging
- Install within this directory: npm install
- Local tests: npm run check; npm run db:migrate:local; npm run dev
- Staging deploy with correct permissions: npm run db:migrate:remote; npm run deploy:staging
- Cloudflare secrets (never in GitHub): ADMIN_API_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ALLOWED_CHAT_IDS (comma-separated, non-empty)

## Routes
- GET /health — public status (no secrets)
- POST /api/telegram/webhook — Telegram signature header and allowed chat checks
- POST /api/intake — admin Bearer token; accepts name, category, image_url, notes, price, quantity
- GET /api/drafts — admin Bearer token
- POST /api/update — admin Bearer token; id, name, category, image_url, price, quantity
- POST /api/verify-image — admin Bearer token; id, verified:true; manual inspection only
- POST /api/decision — admin Bearer token; id, decision: APPROVE or REJECT
- GET /api/catalog-preview — admin Bearer token; preview only
- GET /api/audit — admin Bearer token; basic audit log

## Source file workflow mapping
Product Intake -> Telegram/API ingestion + IntakeWorkflow. Image Processing -> human verification placeholder. Gemini+QA -> manual review only, Gemini pending. Admin Approval Gate -> approval endpoint. GitHub Catalog Sync -> isolated catalog preview, never production. Orchestrator -> Cloudflare Workflows runtime. Error Recovery -> audit and Cloudflare observability (outbound alerting pending).

## Required next phases
Authenticated image storage, media content verification, Gemini extraction, richer admin identity and approval logs, Telegram feedback, external alerting, explicit staged PR-based GitHub sync and browser end-to-end QA. Never enable production publication without a separate explicit approval and verified safeguards.
