import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('marketplace_credentials')
@Index(['tenant_id', 'marketplace_account_id'], { unique: true })
export class MarketplaceCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  marketplace_account_id: string;

  @Column({ type: 'text' })
  encrypted_payload: string;

  @Column({ type: 'varchar', length: 64 })
  encryption_key_id: string;

  @Column({ type: 'integer', default: 1 })
  encryption_version: number;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  rotated_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
