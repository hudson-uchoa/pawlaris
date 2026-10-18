import { useEffect, type ReactElement } from 'react';
import { formatCompletionLost } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { useReplica } from '../../replica/useReplica';
import type { SyncEvents } from '../../sync/events';
import { ToastHost, useToast } from '../../ui/primitives/Toast';

export type SyncToastHostProps = { events: SyncEvents; active: boolean; bottomInset?: number };

export function SyncToastHost({ events, active, bottomInset }: SyncToastHostProps): ReactElement | null {
  const toast = useToast();
  const { members, family } = useReplica((state) => ({ members: state.members, family: state.family }));
  useEffect(() => {
    const lost = events.on('completion_lost', ({ winner }) => {
      const member = members[winner.completed_by];
      if (member !== undefined && family !== null) {
        toast.show(formatCompletionLost(member.display_name, Date.parse(winner.completed_at), family.timezone));
      }
    });
    const rejected = events.on('mutation_rejected', () => { toast.show(strings.toasts.mutationRejected); });
    return () => { lost(); rejected(); };
  }, [events, toast, members, family]);
  return <ToastHost active={active} {...(bottomInset === undefined ? {} : { bottomInset })} />;
}
