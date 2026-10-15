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

// Spec 06 sections 4.10 and 4.11, Q-35.
const starVertexCount = 10;
const starInnerRadiusRatio = 0.5;
const sparkleControlRatio = 0.3;
const crescentInnerRadiusRatio = 0.6;

export function starPath(x: number, y: number, radius: number): string {
  const vertices = Array.from({ length: starVertexCount }, (_, index) => {
    const angle = -Math.PI / 2 + index * 2 * Math.PI / starVertexCount;
    const distance = index % 2 === 0 ? radius : radius * starInnerRadiusRatio;
    return `${index === 0 ? 'M' : 'L'}${x + Math.cos(angle) * distance} ${y + Math.sin(angle) * distance}`;
  });
  return `${vertices.join(' ')} Z`;
}

export function sparklePath(x: number, y: number, radius: number): string {
  const q = sparkleControlRatio * radius;
  return `M${x} ${y - radius}`
    + ` Q${x + q} ${y - q} ${x + radius} ${y}`
    + ` Q${x + q} ${y + q} ${x} ${y + radius}`
    + ` Q${x - q} ${y + q} ${x - radius} ${y}`
    + ` Q${x - q} ${y - q} ${x} ${y - radius} Z`;
}

export function crescentPath(x: number, y: number, radius: number): string {
  // M0 -1 A1 1 0 1 0 0 1 A0.6 1 0 0 1 0 -1 Z, scaled and translated.
  return `M${x} ${y - radius}`
    + ` A${radius} ${radius} 0 1 0 ${x} ${y + radius}`
    + ` A${crescentInnerRadiusRatio * radius} ${radius} 0 0 1 ${x} ${y - radius} Z`;
}

const pawStarToes = [
  { x: 108, y: 264, radius: 50, rotation: -14 },
  { x: 184, y: 156, radius: 58, rotation: -5 },
  { x: 330, y: 150, radius: 75.4, rotation: 5 },
  { x: 404, y: 264, radius: 50, rotation: 14 },
] as const;

// Spec 06 section 4.11: the owner-approved 512 by 512 paw-star master.
export const pawStar = {
  size: 512,
  pad: 'M256 262C300 262 340 300 366 340C392 380 372 430 326 430'
    + 'C300 430 282 414 256 414C230 414 212 430 186 430'
    + 'C140 430 120 380 146 340C172 300 212 262 256 262Z',
  toes: pawStarToes.map((toe) => ({ ...toe, path: sparklePath(toe.x, toe.y, toe.radius) })),
  glow: { x: 330, y: 150, radius: 118, opacity: { dark: 0.5, light: 0.2 } },
} as const;
