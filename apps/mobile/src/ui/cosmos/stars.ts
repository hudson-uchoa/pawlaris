export type StarLayer = 0 | 1 | 2;
export type Star = {
  x: number;
  y: number;
  r: number;
  opacity: number;
  layer: StarLayer;
};

export function generateStars(seed: number, count: number, width: number, height: number): Star[] {
  void seed; void count; void width; void height;
  throw new Error('generateStars is not implemented');
}
