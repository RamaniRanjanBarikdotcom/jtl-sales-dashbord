import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

@Entity('marketing_campaigns')
@Unique(['tenant_id', 'platform', 'external_id'])
export class MarketingCampaign {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ length: 20 })
  platform: string;

  @Column({ length: 100, nullable: true })
  external_id: string;

  @Column({ length: 500, nullable: true })
  name: string;

  @Column({ length: 20, nullable: true })
  status: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  budget_daily: number;

  @CreateDateColumn()
  synced_at: Date;
}
