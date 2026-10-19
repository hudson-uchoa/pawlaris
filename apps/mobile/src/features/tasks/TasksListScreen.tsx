import { localDate, type TaskTemplate } from '@pawlaris/shared';
import { memo, useCallback, useContext, useState, type ReactElement } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { formatScheduleSummary } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { useReplica } from '../../replica/useReplica';
import { Card } from '../../ui/primitives/Card';
import { SegmentedControl } from '../../ui/primitives/SegmentedControl';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import type { TaskScreenProps } from './types';

export type TasksListScreenProps = TaskScreenProps & {
  onOpenTask(taskId: string): void;
};

export function TasksListScreen({ services, active, onOpenTask }: TasksListScreenProps): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const family = useReplica((state) => state.family);
  const ready = useReplica((state) => state.ready);
  const templates = useReplica((state) => state.taskTemplates);
  const pets = useReplica((state) => state.pets);
  const members = useReplica((state) => state.members);
  const [segment, setSegment] = useState<'active' | 'ended'>('active');
  const loading = !ready || family === null;
  const today = family === null ? null : localDate(services.clock.now(), family.timezone);
  const tasks = today === null ? [] : Object.values(templates).filter((task) => {
    const ended = task.ends_on !== null && task.ends_on < today;
    return task.deleted_at === null && ended === (segment === 'ended');
  });

  return <ScrollView style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.md }}>
    <SegmentedControl accessibilityLabel={strings.tasks.heading} active={active} disabled={loading}
      value={segment} options={[{ value: 'active', label: strings.tasks.active }, { value: 'ended', label: strings.tasks.ended }]}
      onValueChange={(value) => { if (value === 'active' || value === 'ended') setSegment(value); }} />
    {loading ? <Skeleton width={spacing.xxl * 4} height={spacing.xxl * 3} active={active} />
      : tasks.map((task) => <TaskRow key={task.id} task={task} active={active} onOpenTask={onOpenTask}
        petNames={task.pet_ids.map((id) => pets[id]?.name).filter((name) => name !== undefined).join(', ')}
        assignee={task.assigned_to === null ? strings.tasks.anyone : members[task.assigned_to]?.display_name ?? null} />)}
  </ScrollView>;
}

type TaskRowProps = {
  task: TaskTemplate;
  petNames: string;
  assignee: string | null;
  active: boolean;
  onOpenTask(taskId: string): void;
};

const TaskRow = memo(function TaskRow({ task, petNames, assignee, active, onOpenTask }: TaskRowProps): ReactElement {
  const open = useCallback(() => { onOpenTask(task.id); }, [onOpenTask, task.id]);
  return <Card accessibilityLabel={task.title} active={active} onPress={open} style={{ gap: spacing.xs }}>
    <Text variant="heading">{task.title}</Text>
    <Text>{petNames}</Text>
    <Text color="textMuted">{formatScheduleSummary({ recurrence: task.recurrence, timesOfDay: task.times_of_day })}</Text>
    {assignee === null ? <Skeleton width={spacing.xxl * 2} height={spacing.lg} active={active} />
      : <Text color="textMuted">{assignee}</Text>}
  </Card>;
});
