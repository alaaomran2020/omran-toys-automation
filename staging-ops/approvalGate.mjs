/**
 * OMRAN TOYS — fail-closed, staging-only approval decision.
 *
 * Pure function: it NEVER writes a product, calls a public API, or publishes.
 * The caller must separately authenticate the request and authorize access.
 */
export function evaluateStagingPreview({ product, actor, environment, controls } = {}) {
  const blockers = [];
  const reject = (condition, code) => { if (condition) blockers.push(code); };
  reject(environment !== 'staging', 'NOT_STAGING');
  reject(controls?.autoPublishEnabled !== false, 'AUTO_PUBLISH_NOT_DISABLED');
  reject(controls?.productionWritesEnabled !== false, 'PRODUCTION_WRITES_NOT_DISABLED');
  reject(actor?.role !== 'AUTHORIZED_PUBLISHER' || typeof actor?.id !== 'string' || !actor.id.trim(), 'UNAUTHORIZED_REVIEWER');
  reject(!product || product.status !== 'READY_FOR_STAGING', 'NOT_READY_FOR_STAGING');
  reject(typeof product?.sku !== 'string' || !product.sku.trim(), 'MISSING_SKU');
  reject(typeof product?.nameAr !== 'string' || !product.nameAr.trim(), 'MISSING_ARABIC_NAME');
  reject(!Number.isInteger(product?.ageMinYears) || !Number.isInteger(product?.ageMaxYears) ||
    product.ageMinYears < 0 || product.ageMaxYears < product.ageMinYears, 'INVALID_AGE_RANGE');

  const hasPriceApproval = product?.isPriceApproved === true &&
    Number.isFinite(product?.approvedPrice) && product.approvedPrice > 0 &&
    typeof product?.approvedById === 'string' && Boolean(product.approvedById.trim());
  reject(!hasPriceApproval, 'PRICE_APPROVAL_REQUIRED');

  const hasSafetyEvidence = product?.safetyVerified === true &&
    typeof product?.safetyVerifiedById === 'string' && Boolean(product.safetyVerifiedById.trim()) &&
    Array.isArray(product?.safetyEvidenceIds) && product.safetyEvidenceIds.length > 0 &&
    product.safetyEvidenceIds.every(ref => typeof ref === 'string' && ref.trim().length > 0);
  reject(!hasSafetyEvidence, 'SAFETY_EVIDENCE_REQUIRED');
  reject((product?.chokingHazard === true || (Number.isInteger(product?.ageMinYears) && product.ageMinYears < 3)) &&
    (typeof product?.safetyWarningAr !== 'string' || !product.safetyWarningAr.trim()), 'ARABIC_WARNING_REQUIRED');

  const verifiedMedia = product?.mediaStatus === 'VERIFIED' &&
    Array.isArray(product?.images) && product.images.length > 0 &&
    product.images.every(key => typeof key === 'string' && /^staging\/[A-Za-z0-9/_-]+\.(?:webp|png|jpe?g)$/i.test(key));
  reject(!verifiedMedia, 'VERIFIED_STAGING_MEDIA_REQUIRED');

  reject(actor?.id && (actor.id === product?.approvedById || actor.id === product?.safetyVerifiedById),
    'SEPARATION_OF_DUTIES_REQUIRED');

  return Object.freeze({
    allowed: blockers.length === 0,
    blockers: Object.freeze(blockers),
    nextState: blockers.length === 0 ? 'STAGING_PREVIEW_ALLOWED' : 'BLOCKED',
  });
}

/** Explicit allowlist; never expose private approval/audit data in a preview. */
export function createStagingPreview(input) {
  const decision = evaluateStagingPreview(input);
  if (!decision.allowed) return { decision, preview: null };
  const p = input.product;
  return {
    decision,
    preview: {
      draftId: p.id,
      sku: p.sku,
      nameAr: p.nameAr,
      ageMinYears: p.ageMinYears,
      ageMaxYears: p.ageMaxYears,
      price: p.approvedPrice,
      currency: 'EGP',
      images: [...p.images],
      safetyWarningAr: p.safetyWarningAr ?? null,
      previewOnly: true,
    },
  };
}
