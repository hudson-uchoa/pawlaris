import type { Member } from '@pawlaris/shared';
import { memo, useCallback, type ReactElement } from 'react';
import { View } from 'react-native';
import { strings } from '../../i18n/strings';
import { Chip } from '../../ui/primitives/Chip';
import { spacing } from '../../ui/tokens/spacing';
import type { DashboardScope } from './types';

export interface ScopeFilterProps {
  viewer: Member;
  members: readonly Member[];
  value: DashboardScope;
  active: boolean;
  onChange(scope: DashboardScope): void;
}

export function ScopeFilter({ viewer, members, value, active, onChange }: ScopeFilterProps): ReactElement | null {
  const mine = useCallback(() => { onChange('mine'); }, [onChange]);
  const all = useCallback(() => { onChange('all'); }, [onChange]);
  if (viewer.role !== 'leader') return null;
  return <View testID="scope-filter" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
    <Chip label={strings.dashboard.mine} accessibilityLabel={strings.dashboard.mine}
      testID="scope-mine" selected={value === 'mine'} active={active} onPress={mine} />
    <Chip label={strings.dashboard.all} accessibilityLabel={strings.dashboard.all}
      testID="scope-all" selected={value === 'all'} active={active} onPress={all} />
    {members.filter((member) => member.id !== viewer.id && member.disabled_at === null && member.deleted_at === null)
      .map((member) => <MemberScope key={member.id} member={member} value={value} active={active} onChange={onChange} />)}
  </View>;
}

const MemberScope = memo(function MemberScope({ member, value, active, onChange }: {
  member: Member;
} & Pick<ScopeFilterProps, 'value' | 'active' | 'onChange'>): ReactElement {
  const select = useCallback(() => { onChange(`user:${member.id}`); }, [onChange, member.id]);
  return <Chip label={member.display_name} accessibilityLabel={member.display_name}
    testID={`scope-user-${member.id}`} selected={value === `user:${member.id}`} active={active} onPress={select} />;
});
