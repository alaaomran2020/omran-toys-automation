/**
 * AI product analysis contract.
 *
 * COST POLICY: exactly ONE call per product in the normal workflow.
 * The only extra call is the explicit "🔄 إعادة تحليل" button.
 */

export interface AiAnalysis {
  name: string;
  shortDescription: string;
  description: string;
  category: string | null;
  brand: string | null;
  color: string | null;
  ageRange: string | null;
  features: string[];
  keywords: string[];
}

export interface AiAnalyzeInput {
  /** Base64-encoded product image (no data: prefix). */
  imageBase64: string;
  mimeType: string;
  price: number;
  stock: number;
}

export class AiProviderError extends Error {}

export class AiParseError extends Error {}

export interface AiProductAnalyzer {
  analyze(input: AiAnalyzeInput): Promise<AiAnalysis>;
}
