import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';

/**
 * REAL HTTP server implementing the omrantoys-store integration contract
 * (auth + HMAC signature + validation + idempotency).
 *
 * This is a test double for the REMOTE STORE SERVICE boundary — the actual
 * store Worker code is implemented and tested in `store-integration/`.
 * The automation's StoreProductService must pass this contract unmodified.
 */

export interface StoreProductRecord {
  id: string;
  idempotencyKey: string;
  body: Record<string, unknown>;
  url: string;
}

interface Options {
  apiKey: string;
  apiSecret: string;
  storeBaseUrl: string;
  /** Artificial latency for publish (double-click tests). */
  delayMs?: number;
}

export class FakeStoreServer {
  private server: ReturnType<typeof createServer> | null = null;
  url = '';
  products: StoreProductRecord[] = [];
  createCalls = 0;
  private counter = 0;
  /** When true, the next POST /api/products responds 500 (then auto-resets). */
  failNext = false;

  constructor(private readonly opts: Options) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        this.respond(res, 500, { error: String(err) });
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const address = this.server!.address() as AddressInfo;
    this.url = `http://127.0.0.1:${address.port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  private respond(res: ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return this.respond(res, 200, { status: 'ok' });
    }

    if (req.method === 'POST' && url.pathname === '/api/products') {
      if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
      if (this.failNext) {
        this.failNext = false;
        return this.respond(res, 500, { error: 'internal store error' });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rawBody = Buffer.concat(chunks).toString('utf8');

      // 1) API key
      const key = req.headers['x-api-key'];
      if (key !== this.opts.apiKey) return this.respond(res, 401, { error: 'invalid api key' });

      // 2) HMAC signature over the raw body
      const expected = createHmac('sha256', this.opts.apiSecret).update(rawBody, 'utf8').digest('hex');
      const signature = req.headers['x-api-signature'];
      if (typeof signature !== 'string' || signature !== expected) {
        return this.respond(res, 401, { error: 'invalid signature' });
      }

      // 3) Idempotency key
      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 64) {
        return this.respond(res, 400, { error: 'idempotency-key required (8-64 chars)' });
      }
      const existing = this.products.find((p) => p.idempotencyKey === idempotencyKey);
      if (existing) {
        // Replay → return the same product, do NOT create a duplicate.
        return this.respond(res, 200, { id: existing.id, url: existing.url });
      }

      // 4) Validation
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return this.respond(res, 400, { error: 'invalid JSON body' });
      }
      const nameAr = body.name_ar;
      const price = body.retail_price;
      const stock = body.stock_quantity;
      const images = body.images;
      if (typeof nameAr !== 'string' || nameAr.trim().length < 3) {
        return this.respond(res, 400, { error: 'name_ar required (>= 3 chars)' });
      }
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
        return this.respond(res, 400, { error: 'retail_price must be a number > 0' });
      }
      if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0) {
        return this.respond(res, 400, { error: 'stock_quantity must be an integer >= 0' });
      }
      if (!Array.isArray(images) || images.length === 0) {
        return this.respond(res, 400, { error: 'images required' });
      }
      if (body.category_id !== null && typeof body.category_id !== 'string') {
        return this.respond(res, 400, { error: 'category_id must be a string or null' });
      }
      const allowedAge = ['0-2', '3-5', '6-8', '9-12', '12+'];
      if (body.age_group !== null && body.age_group !== undefined && !allowedAge.includes(String(body.age_group))) {
        return this.respond(res, 400, { error: 'age_group invalid' });
      }

      // 5) Create
      this.createCalls += 1;
      this.counter += 1;
      const id = `store-product-${this.counter}`;
      const record: StoreProductRecord = {
        id,
        idempotencyKey,
        body,
        url: `${this.opts.storeBaseUrl}/#product=${id}`,
      };
      this.products.push(record);
      return this.respond(res, 201, { id, url: record.url });
    }

    if (req.method === 'GET' && url.pathname === '/api/products') {
      return this.respond(
        res,
        200,
        this.products.map((p) => this.toFrontendShape(p)),
      );
    }

    const productMatch = url.pathname.match(/^\/api\/products\/([\w-]+)$/);
    if (req.method === 'GET' && productMatch) {
      const found = this.products.find((p) => p.id === productMatch[1]);
      if (!found) return this.respond(res, 404, { error: 'product not found' });
      return this.respond(res, 200, this.toFrontendShape(found));
    }

    return this.respond(res, 404, { error: 'not found' });
  }

  private toFrontendShape(p: StoreProductRecord): Record<string, unknown> {
    const b = p.body;
    return {
      id: p.id,
      name: b.name_ar,
      nameEn: b.name_en ?? null,
      category: b.category_id ?? null,
      price: b.retail_price,
      originalPrice: null,
      discountPercent: 0,
      rating: 0,
      reviewsCount: 0,
      stock: b.stock_quantity,
      ageGroup: b.age_group ?? null,
      brand: b.brand ?? null,
      isNew: true,
      isBestSeller: false,
      isFeatured: false,
      sku: b.sku,
      description: b.description ?? null,
      features: b.features ?? [],
      tags: b.tags ?? [],
      images: b.images ?? [],
      url: p.url,
    };
  }
}
