import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { MarketplaceResource } from '../core/marketplace-resource.enum';

@Entity('marketplace_sync_cursors')
@Index(['tenant_id', 'marketplace_account_id', 'resource'], { unique: true })
export class MarketplaceSyncCursor {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenant_id: string;
  @Column({ type: 'uuid' }) marketplace_account_id: string;
  @Column({ type: 'varchar', length: 40 }) resource: MarketplaceResource;
  @Column({ type: 'text', nullable: true }) committed_cursor: string | null;
  @Column({ type: 'timestamptz', nullable: true }) window_end: Date | null;
  @Column({ type: 'bigint', default: 0 }) version: string;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
