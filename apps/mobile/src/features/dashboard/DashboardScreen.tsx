import { addDays, localDate, upcomingCare, type DayView, type DayViewItem } from '@pawlaris/shared';
import { useCallback, useContext, useMemo, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, View, useWindowDimensions, type ListRenderItemInfo } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { strings } from '../../i18n/strings';
import { selectDayView, selectMembers } from '../../replica/selectors';
import { useReplica } from '../../replica/useReplica';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { SyncIndicator } from '../shell/SyncIndicator';
import { DashboardTaskCard } from './DashboardTaskCard';
import { DayHeader } from './DayHeader';
import { ScopeFilter } from './ScopeFilter';
import { UpcomingCare } from './UpcomingCare';
import type { DashboardScope, DashboardScreenProps, DashboardServices } from './types';
import { useNow } from './useNow';

type Group = 'overdue' | 'now' | 'later' | 'done';
type Row = { key: string } & (
  | { kind: 'section'; group: Group; count: number }
  | { kind: 'task'; item: DayViewItem }
  | { kind: 'skeleton' }
  | { kind: 'empty' }
);

function readScope(preferences: DashboardServices['preferences']): DashboardScope {
  const value = preferences.get('scope_filter');
  if (value === 'all' || value === 'mine') return value;
  if (value?.startsWith('user:') && value.length > 5) return `user:${value.slice(5)}`;
  return 'mine';
}

function listRows(view: DayView, loading: boolean, expanded: boolean): Row[] {
  if (loading) return Array.from({ length: 5 }, (_, index) => ({ key: `skeleton-${index}`, kind: 'skeleton' }));
  const rows: Row[] = [];
  for (const group of ['overdue', 'now', 'later', 'done'] as const) {
    const items = view[group];
    if (items.length === 0) continue;
    rows.push({ key: `section-${group}`, kind: 'section', group, count: items.length });
    if (group === 'done' && !expanded) continue;
    for (const item of items) rows.push({ key: `${item.taskId}:${item.occurrenceKey}`, kind: 'task', item });
  }
  if (rows.length === 0) rows.push({ key: 'empty', kind: 'empty' });
  return rows;
}

function rowKey(row: Row): string { return row.key; }

export function DashboardScreen({ services, active, onAdd, onManage, onOpenPet }: DashboardScreenProps): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const { width } = useWindowDimensions();
  const now = useNow(services.clock, 60_000, active);
  const family = useReplica((state) => state.family);
  const ready = useReplica((state) => state.ready);
  const members = useReplica((state) => state.members);
  const familyMembers = useReplica(selectMembers);
  const pets = useReplica((state) => state.pets);
  const healthEvents = useReplica((state) => state.healthEvents);
  const user = services.sessionUser();
  const viewer = user === null ? undefined : members[user.id];
  const today = localDate(now, family?.timezone ?? 'UTC');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const date = selectedDate === null ? today : selectedDate < addDays(today, -90) ? addDays(today, -90)
    : selectedDate > addDays(today, 30) ? addDays(today, 30) : selectedDate;
  const [storedScope, setStoredScope] = useState(() => readScope(services.preferences));
  const scope = viewer?.role === 'leader' ? storedScope : 'mine';
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const expanded = expandedDate === date;
  const [refreshing, setRefreshing] = useState(false);
  const loading = !ready || family === null || viewer === undefined;
  const view = useReplica((state) => selectDayView(state, { date, now, me: user?.id ?? '', scope }));
  const rows = useMemo(() => listRows(view, loading, expanded), [view, loading, expanded]);
  const care = useMemo(() => loading || date !== today ? [] : upcomingCare({
    healthEvents: Object.values(healthEvents), pets: Object.values(pets), today,
  }), [loading, date, today, healthEvents, pets]);
  const changeDay = useCallback((next: string) => {
    if (next < addDays(today, -90) || next > addDays(today, 30)) return;
    setSelectedDate(next === today ? null : next);
    setExpandedDate(null);
  }, [today, setSelectedDate, setExpandedDate]);
  const changeScope = useCallback((next: DashboardScope) => {
    services.preferences.set('scope_filter', next);
    setStoredScope(next);
  }, [services.preferences]);
  const toggleDone = useCallback(() => { setExpandedDate(expanded ? null : date); }, [date, expanded]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await services.engine.kick('refresh'); }
    finally { setRefreshing(false); }
  }, [services.engine]);
  const painted = useCallback(() => {
    services.afterFirstPaint();
    if (!loading) services.marker.dashboardInteractive();
  }, [services, loading]);
  const renderRow = useCallback(({ item: row }: ListRenderItemInfo<Row>): ReactElement => {
    if (row.kind === 'skeleton') return <View testID={`dashboard-${row.key}`}>
      <Skeleton width={Math.max(0, width - spacing.md * 2)} height={spacing.xxl * 3} active={false} />
    </View>;
    if (row.kind === 'empty') return <EmptyState title={strings.dashboard.emptyTitle} active={false}
      action={{ label: strings.dashboard.createTask, accessibilityLabel: strings.dashboard.createTask, onPress: onAdd }} />;
    if (row.kind === 'task') return <DashboardTaskCard item={row.item} members={members}
      viewerId={user?.id ?? ''} date={date} timezone={family?.timezone ?? 'UTC'} />;
    const label = row.group === 'overdue' ? strings.dashboard.overdue(row.count)
      : row.group === 'done' ? strings.dashboard.done(row.count) : strings.dashboard[row.group];
    return row.group === 'done' ? <PressableScale testID="section-done" accessibilityLabel={label}
      accessibilityState={{ expanded }} onPress={toggleDone} active={false}>
      <Text variant="heading">{label}</Text>
    </PressableScale> : <Text testID={`section-${row.group}`} variant="heading" accessibilityRole="header"
      color={row.group === 'overdue' ? 'danger' : 'text'}>{label}</Text>;
  }, [width, onAdd, members, user?.id, date, family?.timezone, expanded, toggleDone]);

  return <View style={{ flex: 1, backgroundColor: color.bg }} onLayout={painted}>
    <FlatList testID="dashboard-list" data={rows} keyExtractor={rowKey} renderItem={renderRow}
      contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
        paddingBottom: spacing.xxl * 2 + (insets?.bottom ?? 0), gap: spacing.sm }}
      refreshControl={<RefreshControl testID="dashboard-refresh" refreshing={refreshing} onRefresh={refresh}
        colors={[color.accent]} tintColor={color.accent} />}
      ListHeaderComponent={<View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
          <DayHeader date={date} today={today} active={false} onChange={changeDay} />
          <SyncIndicator connection={services.engine.state} active={false} />
        </View>
        <Button testID="tasks-manage" label={strings.tasks.heading} accessibilityLabel={strings.tasks.heading}
          active={false} onPress={onManage} />
        {!loading && viewer !== undefined && <ScopeFilter viewer={viewer} members={familyMembers} value={scope}
          active={false} onChange={changeScope} />}
        <UpcomingCare items={care} pets={pets} onOpenPet={onOpenPet} />
      </View>} />
    {!loading && <View style={{ position: 'absolute', right: spacing.md, bottom: spacing.md + (insets?.bottom ?? 0) }}>
      <Button testID="task-add" label={strings.dashboard.add} accessibilityLabel={strings.dashboard.addTask}
        onPress={onAdd} active={false} />
    </View>}
  </View>;
}
