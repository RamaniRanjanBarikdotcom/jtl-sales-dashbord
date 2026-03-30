import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

@Entity('marketing_metrics')
@Unique(['tenant_id', 'campaign_id', 'date'])
export class MarketingMetric {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'bigint', nullable: true })
  campaign_id: number;

  @Column({ type: 'date' })
  date: Date;

  @Column({ length: 20, nullable: true })
  platform: string;

  @Column({ type: 'bigint', default: 0 })
  impressions: number;

  @Column({ type: 'bigint', default: 0 })
  clicks: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  spend: number;

  @Column({ default: 0 })
  conversions: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  conversion_value: number;

  @Column({ type: 'timestamptz', nullable: true })
  synced_at: Date;
}
