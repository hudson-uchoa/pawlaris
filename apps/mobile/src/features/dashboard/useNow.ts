import { useEffect, useState } from 'react';
import type { Clock } from '../../platform/clock';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';

export function useNow(clock: Clock, intervalMs: number, active = true): number {
  const enabled = useAnimationActive(active);
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      const instant = clock.now();
      setNow(instant);
      timer = setTimeout(tick, intervalMs - instant % intervalMs);
    };
    tick();
    return () => { clearTimeout(timer); };
  }, [clock, intervalMs, enabled]);
  return now;
}
