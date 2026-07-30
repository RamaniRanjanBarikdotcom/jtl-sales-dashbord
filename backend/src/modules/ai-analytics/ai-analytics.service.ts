import { ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PlatformConfigService } from '../../config/platform-config.service';
import { AuditService } from '../../common/audit/audit.service';
import { AskQuestionDto, CreateConversationDto, FeedbackDto } from './ai-analytics.dto';
import { AiProviderService, ProviderInputItem } from './ai-provider.service';
import { SALES_METRIC, toolsFor, ToolContext } from './ai-analytics.tools';

const SYSTEM_PROMPT = [
  "You are the JTL Analytics Copilot. You answer business questions about one company's sales data.",
  'You have no direct data access. Call the supplied tools to obtain figures.',
  'Use only numbers returned by tools. Never estimate, extrapolate, or invent a value.',
  'If a tool reports null for a figure, say the value is not available — never report it as zero.',
  'Always state the resolved period and currency you are reporting on.',
  'Keep answers under 120 words. Do not mention tools, SQL, databases, or internal identifiers.',
].join(' ');

@Injectable()
export class AiAnalyticsService {
  private readonly logger = new Logger(AiAnalyticsService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly flags: PlatformConfigService,
    private readonly provider: AiProviderService,
    private readonly audit: AuditService,
  ) {}

  private requireEnabled() {
    if (!this.flags.enabled('AI_ANALYTICS_ENABLED') || !this.flags.enabled('AI_ANALYTICS_SALES_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'Analytics Copilot is disabled' });
    }
  }

  // Booleans only — never the key itself, its length, or the provider response.
  status() {
    const enabled = this.flags.enabled('AI_ANALYTICS_ENABLED') && this.flags.enabled('AI_ANALYTICS_SALES_ENABLED');
    const configured = this.provider.configured();
    return {
      enabled,
      configured,
      ready: enabled && configured,
      reason: !enabled ? 'FEATURE_DISABLED' : !configured ? 'NOT_CONFIGURED' : null,
    };
  }


  async createConversation(tenantId: string, userId: string, dto: CreateConversationDto) {
    this.requireEnabled();
    const rows = await this.db.query(
      `INSERT INTO ai_conversations (tenant_id,user_id,title) VALUES ($1,$2,$3) RETURNING *`,
      [tenantId,userId,dto.title?.trim() || 'New conversation'],
    );
    return rows[0];
  }

  async listConversations(tenantId: string, userId: string) {
    this.requireEnabled();
    return this.db.query(`SELECT * FROM ai_conversations
      WHERE tenant_id=$1 AND user_id=$2 AND status='active' ORDER BY updated_at DESC LIMIT 100`,
      [tenantId,userId]);
  }

  async history(tenantId: string, userId: string, conversationId: string) {
    this.requireEnabled();
    await this.requireConversation(tenantId,userId,conversationId);
    return this.db.query(
      `SELECT id,role,content,citations,created_at FROM ai_messages
       WHERE conversation_id=$1 AND tenant_id=$2 AND role IN ('user','assistant')
       ORDER BY created_at LIMIT 200`,
      [conversationId,tenantId],
    );
  }

  private async requireConversation(tenantId: string, userId: string, conversationId: string) {
    const rows = await this.db.query(
      `SELECT id FROM ai_conversations WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND status='active'`,
      [conversationId,tenantId,userId],
    );
    if (!rows[0]) throw new NotFoundException('Conversation not found');
    return rows[0];
  }

  async ask(tenantId: string, userId: string, permissions: string[], dto: AskQuestionDto) {
    this.requireEnabled();
    const tools = toolsFor(permissions);
    if (!tools.length) throw new ForbiddenException('Sales Copilot permission required');
    if (!this.provider.configured()) {
      throw new ServiceUnavailableException({
        code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'Analytics Copilot is not configured',
      });
    }
    await this.requireConversation(tenantId,userId,dto.conversationId);

    await this.db.query(
      `INSERT INTO ai_messages (conversation_id,tenant_id,role,content) VALUES ($1,$2,'user',$3)`,
      [dto.conversationId,tenantId,dto.question],
    );

    // Prior turns are replayed so follow-ups like "and last month?" resolve. The
    // conversation is tenant- and user-scoped, so this cannot cross companies.
    const priorTurns = await this.db.query(
      `SELECT role,content FROM ai_messages
       WHERE conversation_id=$1 AND tenant_id=$2 AND role IN ('user','assistant')
       ORDER BY created_at DESC LIMIT $3`,
      [dto.conversationId,tenantId,this.flags.integer('AI_HISTORY_TURNS',8,2,20)],
    );
    const input: ProviderInputItem[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...priorTurns.reverse().map((row: { role: string; content: string }) => ({
        role: row.role as 'user' | 'assistant', content: row.content,
      })),
    ];
    if (dto.period) {
      input.push({
        role: 'system',
        content: `The user selected the period "${dto.period}". Use it unless the question names a different one.`,
      });
    }

    const ctx: ToolContext = { db: this.db, tenantId };
    const citations: Array<Record<string, unknown>> = [];
    let data: Record<string, unknown> | null = null;
    let answer: string | null = null;
    const maxCalls = this.flags.integer('AI_MAX_TOOL_CALLS',4,1,8);

    for (let round = 0; round <= maxCalls; round += 1) {
      // The final round offers no tools, so the model must answer from what it
      // already has rather than spending the budget and returning nothing.
      const offered = round === maxCalls
        ? []
        : tools.map(({ name,description,parameters }) => ({ name,description,parameters }));
      const turn = await this.provider.respond(input,offered,`tenant:${tenantId}`);
      if (!turn.toolCalls.length) { answer = turn.text; break; }

      for (const call of turn.toolCalls) {
        const tool = tools.find((candidate) => candidate.name === call.name) ?? null;
        const started = Date.now();
        const record = await this.db.query(
          `INSERT INTO ai_tool_calls (conversation_id,tenant_id,tool_name,arguments,status)
           VALUES ($1,$2,$3,$4,'running') RETURNING id`,
          [dto.conversationId,tenantId,call.name.slice(0,100),JSON.stringify(call.arguments)],
        );
        const toolCallId = record[0].id;
        input.push({
          type: 'function_call', call_id: call.callId, name: call.name,
          arguments: JSON.stringify(call.arguments),
        });

        if (!tool) {
          // Either the model hallucinated a tool name or the caller lacks the
          // permission that would expose it. Both are refusals, not errors.
          await this.db.query(
            `UPDATE ai_tool_calls SET status='rejected',duration_ms=$2,error_code='TOOL_NOT_PERMITTED' WHERE id=$1`,
            [toolCallId,Date.now()-started],
          );
          input.push({ type: 'function_call_output', call_id: call.callId,
            output: JSON.stringify({ error: 'This tool is not available.' }) });
          continue;
        }

        try {
          const result = await tool.run(ctx,call.arguments);
          await this.db.query(
            `INSERT INTO ai_query_results (tool_call_id,tenant_id,result,row_count,expires_at)
             VALUES ($1,$2,$3,1,now()+interval '24 hours')`,
            [toolCallId,tenantId,JSON.stringify(result)],
          );
          await this.db.query(`UPDATE ai_tool_calls SET status='completed',duration_ms=$2 WHERE id=$1`,
            [toolCallId,Date.now()-started]);
          data = result;
          citations.push({ queryReference: toolCallId, tool: tool.name, ...SALES_METRIC });
          input.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(result) });
        } catch (cause) {
          // Swallowing this silently once hid a bug that failed every single
          // tool call. The browser still gets only the generic message below.
          this.logger.error(
            `Copilot tool ${tool.name} failed [${toolCallId}]: ${cause instanceof Error ? cause.message : 'unknown'}`,
          );
          await this.db.query(
            `UPDATE ai_tool_calls SET status='failed',duration_ms=$2,error_code='TOOL_FAILED' WHERE id=$1`,
            [toolCallId,Date.now()-started],
          );
          input.push({ type: 'function_call_output', call_id: call.callId,
            output: JSON.stringify({ error: 'This figure could not be retrieved.' }) });
        }
      }
    }

    if (!answer) {
      throw new ServiceUnavailableException({
        code: 'AI_NO_ANSWER',
        message: 'The Copilot could not produce an answer for this question.',
      });
    }

    const messages = await this.db.query(
      `INSERT INTO ai_messages (conversation_id,tenant_id,role,content,citations)
       VALUES ($1,$2,'assistant',$3,$4) RETURNING *`,
      [dto.conversationId,tenantId,answer,JSON.stringify(citations)],
    );
    await this.db.query(`UPDATE ai_conversations SET updated_at=now() WHERE id=$1`, [dto.conversationId]);
    await this.audit.log({
      action: 'ai.analytics.question', actorId: userId, tenantId, targetId: dto.conversationId,
      metadata: { tools: citations.map((citation) => citation.tool), model: this.provider.model() },
    });
    return { message: messages[0], data, citations };
  }

  async feedback(tenantId: string, userId: string, dto: FeedbackDto) {
    this.requireEnabled();
    const rows = await this.db.query(
      `INSERT INTO ai_feedback (tenant_id,user_id,message_id,rating,comment)
       SELECT $1,$2,m.id,$4,$5 FROM ai_messages m
       WHERE m.id=$3 AND m.tenant_id=$1
       ON CONFLICT (user_id,message_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment
       RETURNING *`, [tenantId,userId,dto.messageId,dto.rating,dto.comment ?? null],
    );
    if (!rows[0]) throw new NotFoundException('Message not found');
    return rows[0];
  }
}
