import type { AuthUser, Family, Member } from '@pawlaris/shared';
import type { SettingsServices } from '../settings/types';

export interface FamilyInvite {
  code: string;
  role: Member['role'];
  expires_at: string;
}

export interface FamilyActions {
  patchFamily(patch: Partial<Pick<Family, 'name' | 'timezone'>>): Promise<void>;
  invite(role: Member['role']): Promise<FamilyInvite | void>;
  changeRole(userId: string, role: Member['role']): Promise<void>;
  removeMember(userId: string): Promise<void>;
  patchProfile(patch: Pick<AuthUser, 'display_name'>): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

export interface FamilyServices extends SettingsServices {
  actions: FamilyActions;
  copyText?(text: string): Promise<void>;
}

export interface FamilyScreenProps {
  services: FamilyServices;
  active: boolean;
}
