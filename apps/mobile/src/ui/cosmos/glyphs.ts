// Spec 06 section 4.12, in the master's 48 by 48 coordinates.
export const insurgeMark = {
  back: 'M3 24 A21 5 0 0 1 45 24',
  front: 'M3 24 A21 5 0 0 0 45 24',
  center: { x: 24, y: 24 },
  ringRadius: 12,
  ringStroke: 3,
  horizonRadius: 10.5,
  arcStroke: 3.2,
  backOpacity: 0.55,
  rotation: -12,
} as const;

export function starPath(x: number, y: number, radius: number): string {
  void x; void y; void radius;
  throw new Error('starPath is not implemented');
}

export function sparklePath(x: number, y: number, radius: number): string {
  void x; void y; void radius;
  throw new Error('sparklePath is not implemented');
}

export function crescentPath(x: number, y: number, radius: number): string {
  void x; void y; void radius;
  throw new Error('crescentPath is not implemented');
}
