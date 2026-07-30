import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ProviderTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderToolCall {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderTurn {
  text: string | null;
  toolCalls: ProviderToolCall[];
}

export type ProviderInputItem =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

/**
 * The only place in the application permitted to hold the OpenAI credential or
 * speak the provider wire format. Everything else goes through `respond`, which
 * guarantees no key, provider header, or raw provider payload ever leaves here.
 */
@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);

  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return !!this.config.get<string>('OPENAI_API_KEY');
  }

  model(): string {
    return this.config.get<string>('OPENAI_MODEL', 'gpt-4.1-mini');
  }

  async respond(input: ProviderInputItem[], tools: ProviderTool[], safetyIdentifier: string): Promise<ProviderTurn> {
    const key = this.config.get<string>('OPENAI_API_KEY');
    if (!key) throw new ServiceUnavailableException({ code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'AI provider is not configured' });

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model(),
          input,
          tools: tools.map((tool) => ({
            type: 'function', name: tool.name, description: tool.description,
            parameters: tool.parameters, strict: true,
          })),
          max_output_tokens: Number(this.config.get<string>('AI_MAX_OUTPUT_TOKENS', '800')),
          safety_identifier: safetyIdentifier,
        }),
        signal: AbortSignal.timeout(Number(this.config.get<string>('AI_PROVIDER_TIMEOUT_MS', '20000'))),
      });
    } catch {
      // The provider error may carry the outbound request including the key.
      throw new ServiceUnavailableException({ code: 'AI_PROVIDER_UNAVAILABLE', message: 'AI provider unavailable' });
    }

    if (!response.ok) {
      this.logger.warn(`AI provider responded ${response.status}`);
      throw new ServiceUnavailableException({ code: 'AI_PROVIDER_UNAVAILABLE', message: 'AI provider unavailable' });
    }

    const payload = await response.json() as {
      output_text?: string;
      output?: Array<{
        type?: string; call_id?: string; name?: string; arguments?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };
    const output = payload.output ?? [];

    const toolCalls: ProviderToolCall[] = [];
    for (const item of output) {
      if (item.type !== 'function_call' || !item.name || !item.call_id) continue;
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(item.arguments || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
      } catch {
        this.logger.warn(`AI provider returned unparseable arguments for ${item.name}`);
      }
      toolCalls.push({ callId: item.call_id, name: item.name, arguments: args });
    }

    const text = payload.output_text ?? output
      .flatMap((item) => item.content ?? [])
      .find((item) => item.type === 'output_text')?.text ?? null;

    return { text: text || null, toolCalls };
  }
}
