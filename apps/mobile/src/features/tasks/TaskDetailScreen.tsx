import { addDays, localDate, splitKey, type AuthUser, type Completion, type DayViewItem, type Member, type Pet, type TaskTemplate } from '@pawlaris/shared';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { memo, useCallback, useContext, useMemo, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { formatFullDate, formatScheduleSummary } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import type { Clock } from '../../platform/clock';
import { selectDayView, selectTimerFor } from '../../replica/selectors';
import { useReplica } from '../../replica/useReplica';
import type { Mutations } from '../../sync/mutations';
import { Button } from '../../ui/primitives/Button';
import { Card } from '../../ui/primitives/Card';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { CompletionAttribution } from '../dashboard/CompletionAttribution';
import { TaskCard } from '../dashboard/TaskCard';
import { PhotoProofThumbnail } from '../dashboard/PhotoProofThumbnail';
import type { PhotoProofTarget } from '../dashboard/types';
import { useNow } from '../dashboard/useNow';
import { CountdownRing } from './CountdownRing';
import { buildTaskHistory, type TaskHistoryRow } from './taskHistory';
import { startOccurrenceTimer } from './timer';

export interface TaskDetailServices {
  clock: Clock;
  sessionUser(): AuthUser;
  mutations: Pick<Mutations, 'createCompletion' | 'undoCompletion' | 'startTimer' | 'cancelTimer'>;
  readCompletionRange(from: string, to: string): readonly Completion[];
}

export interface TaskDetailScreenProps {
  taskId: string;
  services: TaskDetailServices;
  active: boolean;
  onEdit(taskId: string): void;
  onPhotoRequired?: (target: PhotoProofTarget) => void;
  onOpenPhoto?: (assetId: string) => void;
}

// Q-58: inclusive family dates, excluding today, down to today minus 90.
const historyWindow = { pageDays: 30, totalDays: 90 } as const;

export function TaskDetailScreen(props: TaskDetailScreenProps): ReactElement {
  const { color } = useTheme();
  const ready = useReplica((state) => state.ready);
  const family = useReplica((state) => state.family);
  const task = useReplica((state) => state.taskTemplates[props.taskId]);
  const now = useNow(props.services.clock, 60_000, props.active);
  if (!ready || family === null || task === undefined || task.deleted_at !== null) {
    return <View style={{ flex: 1, backgroundColor: color.bg, padding: spacing.md, gap: spacing.md }}>
      <Skeleton width={spacing.xxl * 4} height={spacing.xxl * 2} active={props.active} />
      <Skeleton width={spacing.xxl * 4} height={spacing.xxl * 3} active={props.active} />
    </View>;
  }
  const today = localDate(now, family.timezone);
  return <TaskDetailContent key={`${task.id}:${today}`} {...props} task={task}
    today={today} now={now} timezone={family.timezone} />;
}

function historyKey(row: TaskHistoryRow): string {
  return `${row.occurrenceKey}:${row.petId ?? ''}`;
}

function TaskDetailContent({ task, today, now, timezone, services, active, onEdit,
  onPhotoRequired, onOpenPhoto }: TaskDetailScreenProps & {
  task: TaskTemplate; today: string; now: number; timezone: string;
}): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const pets = useReplica((state) => state.pets);
  const members = useReplica((state) => state.members);
  const completions = useReplica((state) => state.completions);
  const viewerId = services.sessionUser().id;
  const todayCards = useReplica((state) => {
    const view = selectDayView(state, { date: today, now, me: viewerId, scope: 'all' });
    return [...view.overdue, ...view.now, ...view.later, ...view.done]
      .filter((item) => item.taskId === task.id && item.originalDate === today)
      .sort((a, b) => a.occurrenceKey.localeCompare(b.occurrenceKey));
  });
  const [pages, setPages] = useState(1);
  // Cache ranges with the published completion slice as their version, so
  // local undos and incoming sync changes also update already loaded pages.
  const history = useMemo(() => {
    const rows: TaskHistoryRow[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const start = addDays(today, -page * historyWindow.pageDays);
      const from = start < task.starts_on ? task.starts_on : start;
      const to = addDays(today, -(page - 1) * historyWindow.pageDays - 1);
      if (from > to) break;
      rows.push(...buildTaskHistory({ task, from, to,
        completions: services.readCompletionRange(from, `${to}T23:59`) }));
      if (from === task.starts_on) break;
    }
    return { source: completions, rows };
  }, [task, today, pages, services, completions]);
  const loadOlder = useCallback(() => {
    setPages((loaded) => loaded * historyWindow.pageDays >= historyWindow.totalDays
      || addDays(today, -loaded * historyWindow.pageDays) <= task.starts_on ? loaded : loaded + 1);
  }, [today, task.starts_on]);
  const edit = useCallback(() => { onEdit(task.id); }, [onEdit, task.id]);
  const renderHistory = useCallback(({ item }: ListRenderItemInfo<TaskHistoryRow>) => <HistoryRow
    row={item} taskId={task.id} members={members} pets={pets} timezone={timezone} active={active}
    {...(onOpenPhoto === undefined ? {} : { onOpenPhoto })} />,
  [task.id, members, pets, timezone, active, onOpenPhoto]);

  return <View style={{ flex: 1, backgroundColor: color.bg }}>
    <FlashList testID="task-history" data={history.rows} keyExtractor={historyKey} renderItem={renderHistory}
      onEndReached={loadOlder} onEndReachedThreshold={0.2}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.md + (insets?.bottom ?? 0) }}
      ListHeaderComponent={<View style={{ gap: spacing.lg, paddingBottom: spacing.md }}>
        <Card accessibilityLabel={task.title} style={{ gap: spacing.xs }}>
          <Text variant="label">{strings.tasks.categories[task.category]}</Text>
          <Text color="textMuted">{formatScheduleSummary({ recurrence: task.recurrence, timesOfDay: task.times_of_day })}</Text>
          {task.pet_ids.map((id) => <Text key={id}>{pets[id]?.name ?? strings.format.unavailable}</Text>)}
          <Text color="textMuted">{task.assigned_to === null ? strings.tasks.anyone
            : members[task.assigned_to]?.display_name ?? strings.format.unavailable}</Text>
          <Button testID="task-edit" label={strings.tasks.edit} accessibilityLabel={strings.tasks.edit}
            onPress={edit} active={active} />
        </Card>
        <View testID="task-today" style={{ gap: spacing.sm }}>
          <Text variant="heading" accessibilityRole="header">{strings.dashboard.today}</Text>
          {todayCards.map((item) => <TaskCard key={item.occurrenceKey} item={item} members={members}
            viewerId={viewerId} date={today} timezone={timezone} services={services} active={active}
            {...(onPhotoRequired === undefined ? {} : { onPhotoRequired })}
            {...(onOpenPhoto === undefined ? {} : { onOpenPhoto })} />)}
        </View>
        {task.timer_seconds !== null && <TaskTimerSection task={task} cards={todayCards} services={services}
          members={members} viewerId={viewerId} active={active} />}
        <Text variant="heading" accessibilityRole="header">{strings.tasks.history}</Text>
      </View>} />
  </View>;
}

function TaskTimerSection({ task, cards, services, members, viewerId, active }: {
  task: TaskTemplate; cards: readonly DayViewItem[]; services: TaskDetailServices;
  members: Readonly<Record<string, Member>>; viewerId: string; active: boolean;
}): ReactElement {
  const now = useNow(services.clock, 1000, active);
  // Q-59 and 03 section 6: show the latest eligible timer across today's
  // occurrences, including completed ones, before offering a new timer.
  const timer = useReplica((state) => cards.map((card) => selectTimerFor(state, {
    taskId: task.id, occurrenceKey: card.occurrenceKey, petId: null, now,
  })).filter((row) => row !== null).sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at))[0] ?? null);
  const target = cards.find((card) => card.progress.done < card.progress.total);
  return <View style={{ gap: spacing.sm }}>
    <Text variant="heading" accessibilityRole="header">{strings.tasks.timer}</Text>
    {timer !== null ? <>
      <CountdownRing key={timer.id} timer={timer} clock={services.clock} active={active} testID="timer-ring" />
      {timer.started_by !== viewerId && <Text color="textMuted">
        {strings.tasks.timerStartedBy(members[timer.started_by]?.display_name ?? strings.format.unavailable)}
      </Text>}
      <Button testID="timer-cancel" label={strings.tasks.cancelTimer} accessibilityLabel={strings.tasks.cancelTimer}
        onPress={() => { services.mutations.cancelTimer(timer.id); }} active={active} />
    </> : target !== undefined && <Button testID="timer-start" label={strings.tasks.startTimer}
      accessibilityLabel={strings.tasks.startTimer}
      onPress={() => { startOccurrenceTimer(task, target.occurrenceKey, services); }} active={active} />}
  </View>;
}

const HistoryRow = memo(function HistoryRow({ row, taskId, members, pets, timezone, active, onOpenPhoto }: {
  row: TaskHistoryRow; taskId: string; members: Readonly<Record<string, Member>>;
  pets: Readonly<Record<string, Pet>>; timezone: string; active: boolean;
  onOpenPhoto?: (assetId: string) => void;
}): ReactElement {
  const { date, time } = splitKey(row.occurrenceKey);
  const completion = row.completion;
  return <View testID={`task-history-${taskId}-${row.occurrenceKey}${row.petId === null ? '' : `-${row.petId}`}`}
    style={{ paddingVertical: spacing.sm, gap: spacing.xxs }}>
    <Text variant="label">{formatFullDate(date)}</Text>
    <Text variant="caption" color="textMuted">{time ?? strings.format.allDay}</Text>
    {row.petId !== null && <Text variant="caption">{pets[row.petId]?.name ?? strings.format.unavailable}</Text>}
    {completion === null ? <Text variant="caption" color="textMuted">{strings.tasks.notDone}</Text>
      : <>
        <Text variant="label">{completion.title_snapshot}</Text>
        <CompletionAttribution key={completion.id} completion={completion} member={members[completion.completed_by]}
          timezone={timezone} active={active} />
        {completion.photo_asset_id !== null && <PhotoProofThumbnail assetId={completion.photo_asset_id}
          active={active} {...(onOpenPhoto === undefined ? {} : { onOpen: onOpenPhoto })} />}
      </>}
  </View>;
});
