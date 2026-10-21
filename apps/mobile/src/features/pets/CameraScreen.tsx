import { Image } from 'expo-image';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { AppState, View } from 'react-native';
import { strings } from '../../i18n/strings';
import type { CameraDevice, CameraPhoto } from '../../platform/camera';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { Button } from '../../ui/primitives/Button';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import type { CameraMode, PhotoCapture } from './capture';

export type CameraScreenProps = {
  mode: CameraMode;
  device: CameraDevice;
  capture: PhotoCapture;
  active: boolean;
  onUse(id: string): void;
  onCancel(): void;
};

export function CameraScreen({ mode, device, capture, active, onUse, onCancel }: CameraScreenProps): ReactElement {
  const { color } = useTheme();
  const foreground = useAnimationActive(active);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [photo, setPhoto] = useState<CameraPhoto | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const finished = useRef(false);
  const alive = useRef(true);
  const focused = useRef(active);
  const takePhoto = useRef<(() => Promise<CameraPhoto>) | null>(null);
  useLayoutEffect(() => { focused.current = active; }, [active]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!active) return;
    let current = true;
    const check = (request: boolean) => {
      void (request ? device.requestPermission() : device.getPermission()).then((allowed) => {
        if (current) setGranted(allowed);
      }).catch(() => { if (current) setError(strings.camera.error); });
    };
    check(true);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') check(false); });
    return () => { current = false; subscription.remove(); };
  }, [device, active]);
  const onReady = useCallback((take: (() => Promise<CameraPhoto>) | null) => {
    takePhoto.current = take;
    if (alive.current) setReady(take !== null);
  }, []);
  const onCameraError = useCallback(() => { setError(strings.camera.error); setReady(false); }, []);
  async function run(operation: () => Promise<void>): Promise<void> {
    if (running.current || finished.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try { await operation(); }
    catch { if (alive.current && !finished.current) setError(strings.camera.error); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  const canRegister = () => alive.current && focused.current && !finished.current;
  const Preview = device.Preview;
  return <View style={{ flex: 1, backgroundColor: color.bg }}>
    <View style={{ flex: 1 }}>
      {photo !== null ? <Image accessible accessibilityRole="image" accessibilityLabel={strings.pets.photo}
        source={{ uri: photo.uri }} contentFit="contain" transition={0} style={{ flex: 1 }} />
        : granted && foreground && <Preview onReady={onReady} onError={onCameraError} />}
    </View>
    <View style={{ padding: spacing.lg, gap: spacing.sm, backgroundColor: color.surface }}>
      {granted === false && <>
        <Text accessibilityRole="alert">{strings.camera.permissionDenied}</Text>
        <Button label={strings.camera.settings} accessibilityLabel={strings.camera.settings} active={active}
          onPress={() => { void run(() => device.openSettings()); }} disabled={busy} />
      </>}
      {error !== null && <Text accessibilityRole="alert" color="danger">{error}</Text>}
      {photo === null ? <>
        <Button testID="camera-shutter" label={strings.camera.shutter} accessibilityLabel={strings.camera.shutter}
          disabled={!granted || !ready || !foreground || busy} active={active} onPress={() => { void run(async () => {
            const result = await takePhoto.current?.();
            if (result !== undefined && canRegister()) setPhoto(result);
          }); }} />
        {mode === 'avatar' && <Button label={strings.camera.gallery} accessibilityLabel={strings.camera.gallery}
          disabled={busy} active={active} onPress={() => { void run(async () => {
            const result = await device.pickAvatar();
            if (result !== null && canRegister()) setPhoto(result);
          }); }} />}
      </> : <>
        <Button testID="camera-use" label={strings.camera.use} accessibilityLabel={strings.camera.use}
          disabled={busy} active={active} onPress={() => { void run(async () => {
            await capture.save(photo, mode, canRegister, (id) => {
              finished.current = true;
              onUse(id);
            });
          }); }} />
        <Button label={strings.camera.retake} accessibilityLabel={strings.camera.retake} disabled={busy}
          active={active} onPress={() => { takePhoto.current = null; setReady(false); setPhoto(null); }} />
      </>}
      <Button testID="camera-cancel" label={strings.camera.cancel} accessibilityLabel={strings.camera.cancel}
        active={active} onPress={() => { if (!finished.current) { finished.current = true; onCancel(); } }} />
    </View>
  </View>;
}
