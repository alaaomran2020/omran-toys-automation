// ============================================================
// NEW FILE for the store: src/lib/storeApi.js
//
// Loads the remote product catalog (published via the automation
// system) with a silent fallback — if the API is unavailable the
// SPA keeps working exactly as before (local/static data).
// ============================================================

export async function fetchRemoteProducts() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('/api/products?limit=100', { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}
