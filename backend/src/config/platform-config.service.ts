import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const FEATURE_FLAGS = [
  'SYNC_CONTROL_HEARTBEAT_ENABLED', 'SYNC_CONTROL_STATUS_ENABLED',
  'SYNC_CONTROL_COMMANDS_ENABLED', 'SYNC_CONTROL_ADVANCED_COMMANDS_ENABLED',
  'SYNC_CONTROL_MODULE_RESYNC_ENABLED', 'SYNC_CONTROL_ALLOW_OFFLINE_QUEUE',
  'SYSTEM_LOGS_ENABLED', 'SYSTEM_LOGS_EXPORT_ENABLED',
  'SYSTEM_LOGS_API_ENABLED', 'SYSTEM_LOGS_UI_ENABLED',
  'SYSTEM_LOGS_AGENT_EVENTS_ENABLED', 'SYSTEM_LOGS_SECURITY_TAB_ENABLED',
  'SYSTEM_LOGS_RETENTION_ENABLED',
  'AI_ANALYTICS_ENABLED', 'AI_ANALYTICS_SALES_ENABLED',
  'AI_ANALYTICS_OPERATIONS_ENABLED', 'AI_ANALYTICS_LOGS_ENABLED',
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

@Injectable()
export class PlatformConfigService {
  constructor(private readonly config: ConfigService) {}
  enabled(flag: FeatureFlag): boolean {
    const defaults: Partial<Record<FeatureFlag, boolean>> = {
      SYNC_CONTROL_HEARTBEAT_ENABLED: true,
      SYNC_CONTROL_STATUS_ENABLED: true,
      SYNC_CONTROL_ALLOW_OFFLINE_QUEUE: true,
    };
    const raw = this.config.get<string>(flag);
    return raw == null || raw === '' ? defaults[flag] ?? false : raw.trim().toLowerCase() === 'true';
  }
  publicFlags() {
    return Object.fromEntries(FEATURE_FLAGS.map((flag) => [flag, this.enabled(flag)]));
  }

  integer(name: string, fallback: number, minimum: number, maximum: number): number {
    const raw = Number.parseInt(this.config.get<string>(name, String(fallback)), 10);
    return Number.isFinite(raw) ? Math.min(maximum, Math.max(minimum, raw)) : fallback;
  }
}
