import test from 'node:test';
import assert from 'node:assert/strict';
import { createStagingPreview, evaluateStagingPreview } from './approvalGate.mjs';

const makeRequest = () => ({
  environment: 'staging',
  controls: { autoPublishEnabled: false, productionWritesEnabled: false },
  actor: { id: 'publisher-3', role: 'AUTHORIZED_PUBLISHER' },
  product: {
    id: 'draft-123', sku: 'OMR-123', nameAr: 'مكعبات تعليمية',
    status: 'READY_FOR_STAGING', ageMinYears: 4, ageMaxYears: 8,
    isPriceApproved: true, approvedPrice: 350, approvedById: 'reviewer-1',
    safetyVerified: true, safetyVerifiedById: 'safety-reviewer-2',
    safetyEvidenceIds: ['inspection-record-1'], chokingHazard: false,
    mediaStatus: 'VERIFIED', images: ['staging/reviewed/example.webp'],
    internalSupplierCost: 125, internalNotes: 'private',
  },
});

test('valid human-approved product is eligible for staging preview only', () => {
  const { decision, preview } = createStagingPreview(makeRequest());
  assert.equal(decision.allowed, true);
  assert.equal(decision.nextState, 'STAGING_PREVIEW_ALLOWED');
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.currency, 'EGP');
  assert.equal(preview.price, 350);
  assert.equal('internalSupplierCost' in preview, false);
  assert.equal('internalNotes' in preview, false);
  assert.equal('safetyEvidenceIds' in preview, false);
});
test('default missing controls fail closed', () => {
  const request = makeRequest(); delete request.controls;
  assert.equal(evaluateStagingPreview(request).allowed, false);
});
test('production environment and enabled publishing are rejected', () => {
  const a = makeRequest(); a.environment = 'production';
  assert.ok(evaluateStagingPreview(a).blockers.includes('NOT_STAGING'));
  const b = makeRequest(); b.controls.autoPublishEnabled = true;
  assert.ok(evaluateStagingPreview(b).blockers.includes('AUTO_PUBLISH_NOT_DISABLED'));
  const c = makeRequest(); c.controls.productionWritesEnabled = true;
  assert.ok(evaluateStagingPreview(c).blockers.includes('PRODUCTION_WRITES_NOT_DISABLED'));
});
test('unapproved price cannot reach staging preview', () => {
  const request = makeRequest(); request.product.isPriceApproved = false;
  const { decision, preview } = createStagingPreview(request);
  assert.equal(preview, null);
  assert.ok(decision.blockers.includes('PRICE_APPROVAL_REQUIRED'));
});
test('safety verification without recorded evidence is rejected', () => {
  const request = makeRequest(); request.product.safetyEvidenceIds = [];
  assert.ok(evaluateStagingPreview(request).blockers.includes('SAFETY_EVIDENCE_REQUIRED'));
});
test('small-child and choking-risk products require Arabic warnings', () => {
  const request = makeRequest(); request.product.ageMinYears = 2;
  assert.ok(evaluateStagingPreview(request).blockers.includes('ARABIC_WARNING_REQUIRED'));
  request.product.ageMinYears = 4; request.product.chokingHazard = true;
  assert.ok(evaluateStagingPreview(request).blockers.includes('ARABIC_WARNING_REQUIRED'));
});
test('unverified and remote images are never accepted', () => {
  const a = makeRequest(); a.product.mediaStatus = 'NEEDS_REVIEW';
  assert.ok(evaluateStagingPreview(a).blockers.includes('VERIFIED_STAGING_MEDIA_REQUIRED'));
  const b = makeRequest(); b.product.images = ['https://example.org/image.jpg'];
  assert.ok(evaluateStagingPreview(b).blockers.includes('VERIFIED_STAGING_MEDIA_REQUIRED'));
});
test('publisher must be independent of price and safety reviewers', () => {
  const request = makeRequest(); request.actor.id = 'reviewer-1';
  assert.ok(evaluateStagingPreview(request).blockers.includes('SEPARATION_OF_DUTIES_REQUIRED'));
});
test('cannot inspect arbitrary draft by missing authorization', () => {
  const request = makeRequest(); request.actor.role = 'CONTENT_EDITOR';
  assert.equal(createStagingPreview(request).preview, null);
});
