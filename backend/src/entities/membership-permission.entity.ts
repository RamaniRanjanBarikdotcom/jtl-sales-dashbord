import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('membership_permissions')
@Index(['membership_id'])
@Index(['membership_id', 'permission_key'], { unique: true })
export class MembershipPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  membership_id: string;

  @Column({ length: 100 })
  permission_key: string;

  @Column({ type: 'uuid', nullable: true })
  granted_by: string;

  @CreateDateColumn()
  granted_at: Date;
}
