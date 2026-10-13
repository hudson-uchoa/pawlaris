export function fakeClock(initial: number) {
  let instant = initial;
  return {
    now: (): number => instant,
    advance: (milliseconds: number): void => { instant += milliseconds; },
  };
}
