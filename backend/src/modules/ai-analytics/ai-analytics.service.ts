import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PlatformConfigService } from '../../config/platform-config.service';
import { AuditService } from '../../common/audit/audit.service';
import { AskQuestionDto, CreateConversationDto, FeedbackDto } from './ai-analytics.dto';

const METRIC = {
  metricDefinitionId: 'sales.net_revenue.non_cancelled_orders.v1',
  metricLabel: 'Revenue from non-cancelled orders',
  metricVersion: 1,
};

@Injectable()
export class AiAnalyticsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly flags: PlatformConfigService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private requireEnabled() {
    if (!this.flags.enabled('AI_ANALYTICS_ENABLED') || !this.flags.enabled('AI_ANALYTICS_SALES_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'Analytics Copilot is disabled' });
    }
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

  async ask(tenantId: string, userId: string, permissions: string[], dto: AskQuestionDto) {
    this.requireEnabled();
    if (!permissions.includes('*') && !permissions.includes('ai.sales.view')) {
      throw new ForbiddenException('Sales Copilot permission required');
    }
    const conversation = await this.db.query(
      `SELECT id FROM ai_conversations WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND status='active'`,
      [dto.conversationId,tenantId,userId],
    );
    if (!conversation[0]) throw new NotFoundException('Conversation not found');
    await this.db.query(`INSERT INTO ai_messages (conversation_id,tenant_id,role,content)
      VALUES ($1,$2,'user',$3)`, [dto.conversationId,tenantId,dto.question]);

    const period = dto.period || this.inferPeriod(dto.question);
    const started = Date.now();
    const toolCall = await this.db.query(
      `INSERT INTO ai_tool_calls (conversation_id,tenant_id,tool_name,arguments,status)
       VALUES ($1,$2,'get_sales_summary',$3,'running') RETURNING id`,
      [dto.conversationId,tenantId,JSON.stringify({ period })],
    );
    try {
      const summary = await this.salesSummary(tenantId, period);
      await this.db.query(`INSERT INTO ai_query_results
        (tool_call_id,tenant_id,result,row_count,expires_at) VALUES ($1,$2,$3,1,now()+interval '24 hours')`,
        [toolCall[0].id,tenantId,JSON.stringify(summary)]);
      const answer = await this.composeAnswer(dto.question, summary);
      const messages = await this.db.query(`INSERT INTO ai_messages
        (conversation_id,tenant_id,role,content,citations) VALUES ($1,$2,'assistant',$3,$4) RETURNING *`,
        [dto.conversationId,tenantId,answer,JSON.stringify([{ queryReference: toolCall[0].id, ...METRIC }])]);
      await this.db.query(`UPDATE ai_tool_calls SET status='completed',duration_ms=$2 WHERE id=$1`,
        [toolCall[0].id,Date.now()-started]);
      await this.db.query(`UPDATE ai_conversations SET updated_at=now() WHERE id=$1`, [dto.conversationId]);
      await this.audit.log({ action: 'ai.analytics.question', actorId: userId, tenantId,
        targetId: dto.conversationId, metadata: { tool: 'get_sales_summary', period } });
      return { message: messages[0], data: summary, queryReference: toolCall[0].id };
    } catch (error: unknown) {
      await this.db.query(`UPDATE ai_tool_calls SET status='failed',duration_ms=$2,error_code='TOOL_FAILED' WHERE id=$1`,
        [toolCall[0].id,Date.now()-started]);
      throw error;
    }
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

  private inferPeriod(question: string): string {
    const q = question.toLowerCase();
    if (q.includes('yesterday')) return 'yesterday';
    if (q.includes('last week')) return 'last_week';
    if (q.includes('this week')) return 'this_week';
    if (q.includes('last month')) return 'last_month';
    if (q.includes('this month')) return 'this_month';
    if (q.includes('this year')) return 'this_year';
    return 'today';
  }

  private async salesSummary(tenantId: string, period: string) {
    const settings = await this.db.query(`SELECT timezone,currency,locale FROM tenants WHERE id=$1`, [tenantId]);
    const timezone = settings[0]?.timezone || 'Europe/Berlin';
    const rows = await this.db.query(
      `WITH bounds AS (
        SELECT CASE $2
          WHEN 'yesterday' THEN (now() AT TIME ZONE $3)::date - 1
          WHEN 'this_week' THEN date_trunc('week',now() AT TIME ZONE $3)::date
          WHEN 'last_week' THEN date_trunc('week',now() AT TIME ZONE $3)::date - 7
          WHEN 'this_month' THEN date_trunc('month',now() AT TIME ZONE $3)::date
          WHEN 'last_month' THEN (date_trunc('month',now() AT TIME ZONE $3) - interval '1 month')::date
          WHEN 'this_year' THEN date_trunc('year',now() AT TIME ZONE $3)::date
          ELSE (now() AT TIME ZONE $3)::date END AS start_date,
        CASE $2
          WHEN 'yesterday' THEN (now() AT TIME ZONE $3)::date - 1
          WHEN 'last_week' THEN date_trunc('week',now() AT TIME ZONE $3)::date - 1
          WHEN 'last_month' THEN date_trunc('month',now() AT TIME ZONE $3)::date - 1
          ELSE (now() AT TIME ZONE $3)::date END AS end_date
      )
      SELECT COALESCE(SUM(o.gross_revenue),0)::numeric AS revenue,
        COUNT(o.id)::int AS orders,
        COALESCE(SUM(items.units),0)::int AS units,
        CASE WHEN COUNT(o.id)=0 THEN 0 ELSE COALESCE(SUM(o.gross_revenue),0)/COUNT(o.id) END::numeric AS average_order_value,
        b.start_date,b.end_date
      FROM bounds b
      LEFT JOIN orders o ON o.tenant_id=$1 AND o.order_date::date BETWEEN b.start_date AND b.end_date
        AND LOWER(COALESCE(o.status,'')) NOT IN ('cancelled','canceled','storniert','storno')
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(oi.quantity),0) AS units
        FROM order_items oi WHERE oi.tenant_id=o.tenant_id AND oi.order_id=o.jtl_order_id
      ) items ON true
      GROUP BY b.start_date,b.end_date`, [tenantId,period,timezone],
    );
    const row = rows[0];
    return {
      period: { preset: period, from: row.start_date, to: row.end_date, timezone },
      currency: settings[0]?.currency || 'EUR',
      revenue: Number(row.revenue), orders: Number(row.orders), units: Number(row.units),
      averageOrderValue: Number(row.average_order_value),
      metric: METRIC,
      freshness: await this.db.query(`SELECT MAX(last_success_at) AS last_success_at
        FROM tenant_connections WHERE tenant_id=$1`, [tenantId]).then((r) => r[0]?.last_success_at ?? null),
    };
  }

  private async composeAnswer(question: string, summary: Record<string, unknown>): Promise<string> {
    const key = this.config.get<string>('OPENAI_API_KEY');
    if (!key) {
      return `For ${JSON.stringify(summary.period)}, revenue was ${summary.revenue} ${summary.currency} across ${summary.orders} orders (${summary.units} units). Average order value was ${summary.averageOrderValue} ${summary.currency}.`;
    }
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.get<string>('OPENAI_MODEL', 'gpt-4.1-mini'),
        input: [{ role: 'system', content: 'Answer briefly using only the supplied analytics JSON. Never invent values.' },
          { role: 'user', content: JSON.stringify({ question, summary }) }],
        max_output_tokens: 500,
      }),
      signal: AbortSignal.timeout(Number(this.config.get<string>('AI_PROVIDER_TIMEOUT_MS', '15000'))),
    });
    if (!response.ok) throw new ServiceUnavailableException({ code: 'AI_PROVIDER_UNAVAILABLE', message: 'AI provider unavailable' });
    const payload = await response.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    const text = payload.output_text ?? payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === 'output_text')?.text;
    return text || 'The analytics result is available in the attached data.';
  }
}
