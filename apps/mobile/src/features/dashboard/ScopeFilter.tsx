import type { Member } from '@pawlaris/shared';
import type { ReactElement } from 'react';
import type { DashboardScope } from './types';

export interface ScopeFilterProps {
  viewer: Member;
  members: readonly Member[];
  value: DashboardScope;
  active: boolean;
  onChange(scope: DashboardScope): void;
}

export function ScopeFilter(_props: ScopeFilterProps): ReactElement | null {
  throw new Error('not implemented');
}
