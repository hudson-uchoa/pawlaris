import { BlurStyle, createPicture, Skia, TileMode, vec } from '@shopify/react-native-skia';
import type { ThemeColors } from '../theme';
import { starfield, starTints } from '../tokens/cosmos';
import type { Sky } from './sky';

export function transparentColor(token: string): Float32Array {
  const color = Skia.Color(token);
  color[3] = 0;
  return color;
}

export function recordSky(sky: Sky, width: number, height: number,
  color: ThemeColors, full: boolean) {
  return createPicture((canvas) => {
    const paint = Skia.Paint();
    paint.setShader(Skia.Shader.MakeLinearGradient(vec(0, 0), vec(0, height),
      [Skia.Color(color.skyTop), Skia.Color(color.skyBottom)], null, TileMode.Clamp));
    canvas.drawRect(Skia.XYWHRect(0, 0, width, height), paint);
    if (!full) return;
    const { band } = sky;
    canvas.save();
    canvas.translate(width / 2, band.offset);
    canvas.rotate(band.angle, 0, 0);
    const half = Math.hypot(width, height);
    paint.setShader(Skia.Shader.MakeLinearGradient(vec(0, -band.width / 2), vec(0, band.width / 2),
      [transparentColor(color.nebulaA), Skia.Color(color.nebulaA), transparentColor(color.nebulaA)],
      [0, 0.5, 1], TileMode.Clamp));
    paint.setAlphaf(starfield.band.alpha);
    paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, band.width * starfield.band.blur, true));
    canvas.drawRect(Skia.XYWHRect(-half, -band.width / 2, half * 2, band.width), paint);
    canvas.restore();
    const dustPaint = Skia.Paint();
    dustPaint.setColor(Skia.Color(color.starfield));
    for (const dust of sky.dust) {
      dustPaint.setAlphaf(dust.alpha);
      canvas.drawCircle(dust.x, dust.y, starfield.band.dustRadius, dustPaint);
    }
  }, { width, height });
}

export function renderGlowSprite() {
  const { size, radius } = starfield.sprite;
  const surface = Skia.Surface.MakeOffscreen(size, size);
  if (surface === null) return null;
  const paint = Skia.Paint();
  const center = vec(size / 2, size / 2);
  paint.setShader(Skia.Shader.MakeRadialGradient(center, radius,
    [Skia.Color(starTints[1]), Skia.Color(starTints[1]), transparentColor(starTints[1])],
    [0, 0.55, 1], TileMode.Clamp));
  surface.getCanvas().drawCircle(center.x, center.y, radius, paint);
  surface.flush();
  return surface.makeImageSnapshot();
}
