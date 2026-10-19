import type { ReactElement } from 'react';
import { useReplica } from '../../replica/useReplica';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { spacing } from '../../ui/tokens/spacing';
import { HealthFormScreen } from './HealthFormScreen';
import type { HealthScreenProps } from './types';

export type HealthDetailScreenProps = HealthScreenProps & {
  eventId: string;
};

export function HealthDetailScreen(props: HealthDetailScreenProps): ReactElement {
  const event = useReplica((state) => state.healthEvents[props.eventId]);
  if (event === undefined) {
    return <Skeleton width={spacing.xxl * 4} height={spacing.xxl * 3} active={props.active} />;
  }
  return <HealthFormScreen {...props} petId={event.pet_id} />;
}
