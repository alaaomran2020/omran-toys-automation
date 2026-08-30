import { createHmac } from 'node:crypto';

/**
 * Store Integration — server-to-server client for omrantoys-store.
 *
 * Contract (implemented by the store's Worker API, see store-integration/):
 *   POST /api/products  (authenticated: x-api-key + HMAC signature, idempotent)
 *   GET  /api/products
 *   GET  /api/products/:id
 *   GET  /api/health
 *
 * The Telegram layer never sees store/database details — it only talks to
 * this service through the Product Workflow.
 */

export interface StoreProductCreateInput {
  nameAr: string;
  nameEn?: string | null;
  description?: string | null;
  categoryId?: string | null;
  price: number;
  stock: number;
  brand?: string | null;
  ageGroup?: string | null;
  images: string[];
  features: string[];
  tags: string[];
  sku: string;
  slug: string;
}

export interface StoreProductRef {
  id: string;
  url: string | null;
}

export class StoreApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly isTimeout = false,
  ) {
    super(message);
  }
}

export interface StoreProductServiceOptions {
  apiBaseUrl: string;
  apiKey: string;
  apiSecret: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class StoreProductService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: StoreProductServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private get base(): string {
    return this.options.apiBaseUrl.replace(/\/+$/, '');
  }

  private sign(body: string): string {
    return createHmac('sha256', this.options.apiSecret).update(body, 'utf8').digest('hex');
  }

  private async request(
    path: string,
    init: { method: string; body?: string; extraHeaders?: Record<string, string> },
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchImpl(`${this.base}${path}`, {
        method: init.method,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey,
          ...(init.body !== undefined ? { 'x-api-signature': this.sign(init.body) } : {}),
          ...(init.extraHeaders ?? {}),
        },
        body: init.body,
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new StoreApiError(408, 'store API timeout', true);
      throw new StoreApiError(0, `store API network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Create a product in the store.
   *
   * Idempotency: `idempotencyKey` (the draft ID) is stored by the store with
   * the product — replays (timeouts, retries) return the SAME product instead
   * of creating a duplicate.
   */
  async createProduct(input: StoreProductCreateInput, idempotencyKey: string): Promise<StoreProductRef> {
    const body = JSON.stringify({
      name_ar: input.nameAr,
      name_en: input.nameEn ?? null,
      description: input.description ?? null,
      category_id: input.categoryId ?? null,
      retail_price: input.price,
      stock_quantity: input.stock,
      brand: input.brand ?? null,
      age_group: input.ageGroup ?? null,
      images: input.images,
      features: input.features,
      tags: input.tags,
      sku: input.sku,
      slug: input.slug,
      is_new: true,
    });

    const res = await this.request('/api/products', {
      method: 'POST',
      body,
      extraHeaders: { 'idempotency-key': idempotencyKey },
    });
    const data = (await res.json().catch(() => null)) as { id?: unknown; url?: unknown; error?: unknown } | null;

    if (res.ok) {
      if (typeof data?.id !== 'string' || data.id.length === 0) {
        throw new StoreApiError(502, 'store API returned an invalid product id');
      }
      return {
        id: data.id,
        url: typeof data?.url === 'string' && data.url.length > 0 ? data.url : null,
      };
    }
    throw new StoreApiError(res.status, String(data?.error ?? `store error ${res.status}`));
  }

  /** Fetch a product by id. Returns null on 404. */
  async getProduct(id: string): Promise<Record<string, unknown> | null> {
    const res = await this.request(`/api/products/${encodeURIComponent(id)}`, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
      throw new StoreApiError(res.status, String(data?.error ?? `store error ${res.status}`));
    }
    return (await res.json()) as Record<string, unknown>;
  }
}
