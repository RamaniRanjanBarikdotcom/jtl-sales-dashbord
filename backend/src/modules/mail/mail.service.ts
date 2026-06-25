import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect as tlsConnect, TLSSocket } from 'tls';
import { connect as netConnect, Socket } from 'net';

export interface MailAddress {
  email: string;
  name?: string | null;
}

export interface SendMailInput {
  to: Array<string | MailAddress>;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface InventoryAlertMailRow {
  product_name: string;
  article_number?: string | null;
  total_available: number | string;
  status: string;
  days_of_stock?: number | string | null;
  reorder_point?: number | string | null;
}

type SmtpSocket = Socket | TLSSocket;

type SmtpResponse = {
  code: number;
  lines: string[];
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return this.config.get<string>('MAIL_ENABLED', 'false').toLowerCase() === 'true';
  }

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('SMTP_HOST') && this.config.get<string>('MAIL_FROM'));
  }

  async sendInviteEmail(input: {
    to: string;
    name: string;
    tempPassword: string;
    actorLabel?: string;
  }) {
    const appUrl = this.getFrontendUrl();
    const subject = 'Your JTL Analytics dashboard invite';
    const text = [
      `Hi ${input.name},`,
      '',
      'You have been invited to JTL Analytics.',
      `Sign in: ${appUrl}`,
      `Email: ${input.to}`,
      `Temporary password: ${input.tempPassword}`,
      '',
      'You will be asked to change this password after signing in.',
      input.actorLabel ? `Invited by: ${input.actorLabel}` : '',
    ].filter(Boolean).join('\n');
    const html = this.wrapHtml(`
      <p>Hi ${this.escapeHtml(input.name)},</p>
      <p>You have been invited to <strong>JTL Analytics</strong>.</p>
      <p><a href="${this.escapeAttr(appUrl)}">Open dashboard</a></p>
      <table role="presentation" cellspacing="0" cellpadding="0">
        <tr><td><strong>Email</strong></td><td>${this.escapeHtml(input.to)}</td></tr>
        <tr><td><strong>Temporary password</strong></td><td><code>${this.escapeHtml(input.tempPassword)}</code></td></tr>
      </table>
      <p>You will be asked to change this password after signing in.</p>
    `);
    return this.sendMail({ to: [input.to], subject, text, html });
  }

  async sendPasswordResetEmail(input: { to: string; name: string; tempPassword: string }) {
    const appUrl = this.getFrontendUrl();
    const subject = 'Your JTL Analytics temporary password';
    const text = [
      `Hi ${input.name},`,
      '',
      'Your JTL Analytics password was reset.',
      `Sign in: ${appUrl}`,
      `Temporary password: ${input.tempPassword}`,
      '',
      'You will be asked to change this password after signing in.',
    ].join('\n');
    const html = this.wrapHtml(`
      <p>Hi ${this.escapeHtml(input.name)},</p>
      <p>Your JTL Analytics password was reset.</p>
      <p><a href="${this.escapeAttr(appUrl)}">Open dashboard</a></p>
      <p><strong>Temporary password:</strong> <code>${this.escapeHtml(input.tempPassword)}</code></p>
      <p>You will be asked to change this password after signing in.</p>
    `);
    return this.sendMail({ to: [input.to], subject, text, html });
  }

  async sendInventoryAlertsEmail(input: {
    to: string[];
    companyName: string;
    alerts: InventoryAlertMailRow[];
  }) {
    const topAlerts = input.alerts.slice(0, 25);
    const subject = `[JTL Analytics] ${input.alerts.length} inventory alert${input.alerts.length === 1 ? '' : 's'} for ${input.companyName}`;
    const textRows = topAlerts.map((row, index) => (
      `${index + 1}. ${row.product_name} (${row.article_number || '-'}) — ${row.status}, stock ${row.total_available}, DSI ${row.days_of_stock ?? '-'}`
    ));
    const text = [
      `Inventory alerts for ${input.companyName}`,
      '',
      `${input.alerts.length} products are low or out of stock.`,
      '',
      ...textRows,
    ].join('\n');
    const htmlRows = topAlerts.map((row) => `
      <tr>
        <td>${this.escapeHtml(row.product_name)}</td>
        <td>${this.escapeHtml(String(row.article_number || '-'))}</td>
        <td>${this.escapeHtml(row.status)}</td>
        <td>${this.escapeHtml(String(row.total_available))}</td>
        <td>${this.escapeHtml(String(row.days_of_stock ?? '-'))}</td>
      </tr>
    `).join('');
    const html = this.wrapHtml(`
      <p><strong>${input.alerts.length}</strong> products are low or out of stock for ${this.escapeHtml(input.companyName)}.</p>
      <table cellspacing="0" cellpadding="6" border="1">
        <thead><tr><th>Product</th><th>Article</th><th>Status</th><th>Stock</th><th>DSI</th></tr></thead>
        <tbody>${htmlRows}</tbody>
      </table>
      ${input.alerts.length > topAlerts.length ? `<p>Showing top ${topAlerts.length} alerts.</p>` : ''}
    `);
    return this.sendMail({ to: input.to, subject, text, html });
  }

  async sendMail(input: SendMailInput): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
    const recipients = this.normalizeRecipients(input.to);
    if (recipients.length === 0) return { ok: false, skipped: true, reason: 'no_recipients' };
    if (!this.isEnabled()) {
      this.logger.log(`Email skipped; MAIL_ENABLED=false subject="${input.subject}" recipients=${recipients.length}`);
      return { ok: true, skipped: true, reason: 'mail_disabled' };
    }
    if (!this.isConfigured()) {
      this.logger.warn(`Email skipped; SMTP_HOST or MAIL_FROM missing subject="${input.subject}"`);
      return { ok: false, skipped: true, reason: 'mail_not_configured' };
    }

    const from = this.config.get<string>('MAIL_FROM') as string;
    const message = this.buildMessage({ ...input, to: recipients }, from);
    await this.sendSmtp({ from, recipients, message });
    this.logger.log(`Email sent subject="${input.subject}" recipients=${recipients.length}`);
    return { ok: true };
  }

  private async sendSmtp(input: { from: string; recipients: string[]; message: string }) {
    const host = this.config.get<string>('SMTP_HOST') as string;
    const port = Number(this.config.get<string>('SMTP_PORT', '587'));
    const secure = this.config.get<string>('SMTP_SECURE', 'false').toLowerCase() === 'true' || port === 465;
    const startTls = this.config.get<string>('SMTP_STARTTLS', secure ? 'false' : 'true').toLowerCase() !== 'false';
    const username = this.config.get<string>('SMTP_USER');
    const password = this.config.get<string>('SMTP_PASSWORD');
    const helloName = this.config.get<string>('SMTP_HELO_NAME', 'localhost');

    let socket: SmtpSocket = await this.openSocket(host, port, secure);
    await this.readResponse(socket, [220]);
    await this.command(socket, `EHLO ${helloName}`, [250]);

    if (!secure && startTls) {
      await this.command(socket, 'STARTTLS', [220]);
      socket = await this.upgradeToTls(socket, host);
      await this.command(socket, `EHLO ${helloName}`, [250]);
    }

    if (username && password) {
      const auth = Buffer.from(`\0${username}\0${password}`, 'utf8').toString('base64');
      await this.command(socket, `AUTH PLAIN ${auth}`, [235]);
    }

    await this.command(socket, `MAIL FROM:<${this.extractEmail(input.from)}>`, [250]);
    for (const recipient of input.recipients) {
      await this.command(socket, `RCPT TO:<${this.extractEmail(recipient)}>`, [250, 251]);
    }
    await this.command(socket, 'DATA', [354]);
    socket.write(`${input.message.replace(/\r?\n/g, '\r\n')}\r\n.\r\n`);
    await this.readResponse(socket, [250]);
    await this.command(socket, 'QUIT', [221]);
    socket.end();
  }

  private openSocket(host: string, port: number, secure: boolean): Promise<SmtpSocket> {
    return new Promise((resolve, reject) => {
      const socket = secure
        ? tlsConnect({ host, port, servername: host })
        : netConnect({ host, port });
      socket.once('connect', () => resolve(socket));
      socket.once('secureConnect', () => resolve(socket));
      socket.once('error', reject);
      socket.setTimeout(20_000, () => {
        socket.destroy(new Error('SMTP connection timed out'));
      });
    });
  }

  private upgradeToTls(socket: SmtpSocket, host: string): Promise<TLSSocket> {
    return new Promise((resolve, reject) => {
      socket.removeAllListeners('data');
      const tlsSocket = tlsConnect({ socket, servername: host });
      tlsSocket.once('secureConnect', () => resolve(tlsSocket));
      tlsSocket.once('error', reject);
    });
  }

  private command(socket: SmtpSocket, value: string, expected: number[]) {
    socket.write(`${value}\r\n`);
    return this.readResponse(socket, expected);
  }

  private readResponse(socket: SmtpSocket, expected: number[]): Promise<SmtpResponse> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const cleanup = () => {
        socket.off('data', onData);
        socket.off('error', onError);
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        if (lines.length === 0) return;
        const last = lines[lines.length - 1];
        if (!/^\d{3} /.test(last)) return;
        cleanup();
        const code = Number(last.slice(0, 3));
        if (!expected.includes(code)) {
          reject(new Error(`SMTP command failed: ${lines.join(' | ')}`));
          return;
        }
        resolve({ code, lines });
      };
      socket.on('data', onData);
      socket.once('error', onError);
    });
  }

  private buildMessage(input: Omit<SendMailInput, 'to'> & { to: string[] }, from: string): string {
    const boundary = `jtl_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const headers = [
      `From: ${this.formatHeaderAddress(from)}`,
      `To: ${input.to.map((to) => this.formatHeaderAddress(to)).join(', ')}`,
      `Subject: ${this.encodeHeader(input.subject)}`,
      'MIME-Version: 1.0',
      input.html ? `Content-Type: multipart/alternative; boundary="${boundary}"` : 'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      input.replyTo ? `Reply-To: ${this.formatHeaderAddress(input.replyTo)}` : '',
    ].filter(Boolean);

    if (!input.html) return `${headers.join('\r\n')}\r\n\r\n${input.text}`;
    return [
      headers.join('\r\n'),
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      input.text,
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      input.html,
      `--${boundary}--`,
      '',
    ].join('\r\n');
  }

  private normalizeRecipients(input: Array<string | MailAddress>): string[] {
    return [...new Set(input
      .map((item) => typeof item === 'string' ? item : item.email)
      .map((email) => email.trim())
      .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)))];
  }

  private getFrontendUrl(): string {
    return String(this.config.get<string>('FRONTEND_URL', 'http://localhost:3000')).split(',')[0].trim();
  }

  private formatHeaderAddress(value: string): string {
    const email = this.extractEmail(value);
    const name = value.replace(/<[^>]+>/, '').trim();
    return name && name !== email ? `${this.encodeHeader(name)} <${email}>` : email;
  }

  private extractEmail(value: string): string {
    const match = value.match(/<([^>]+)>/);
    return (match ? match[1] : value).trim();
  }

  private encodeHeader(value: string): string {
    if (/^[\x20-\x7E]*$/.test(value)) return value.replace(/[\r\n]/g, ' ');
    return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  }

  private wrapHtml(body: string): string {
    return `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">${body}</body></html>`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] as string));
  }

  private escapeAttr(value: string): string {
    return this.escapeHtml(value).replace(/'/g, '&#39;');
  }
}
