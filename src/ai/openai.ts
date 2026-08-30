import { parseAiAnalysis } from './parse.js';
import { buildUserText, SYSTEM_PROMPT } from './prompt.js';
import type { AiAnalysis, AiAnalyzeInput, AiProductAnalyzer } from './provider.js';
import { AiProviderError } from './provider.js';

/**
 * OpenAI vision implementation of the analyzer.
 *
 * One HTTP call, JSON mode, cheap model by default (cost policy:
 * 1 product = 1 AI call; re-analyze only on the explicit button).
 * No SDK — plain fetch against the Chat Completions API.
 */
export class OpenAiProductAnalyzer implements AiProductAnalyzer {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      baseUrl: string;
      timeoutMs: number;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async analyze(input: AiAnalyzeInput): Promise<AiAnalysis> {
    const body = {
      model: this.options.model,
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildUserText(input) },
            { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.imageBase64}` } },
          ],
        },
      ],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new AiProviderError('AI request timeout');
      throw new AiProviderError(`AI network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new AiProviderError(`AI request failed with status ${res.status}: ${detail}`);
    }

    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new AiProviderError('AI response missing content');
    return parseAiAnalysis(content);
  }
}
