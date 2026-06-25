import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('revoked_tokens')
@Index(['expires_at'])
export class RevokedToken {
  @PrimaryColumn({ length: 100 })
  jti: string;

  @CreateDateColumn()
  revoked_at: Date;

  @Column({ type: 'timestamptz' })
  expires_at: Date;
}
