# Test devices

The family's two phones. Every `**Device:**` check in `spec/08-tasks.md` is
run on both (`spec/07-test-harness.md` §13). Read over `adb` on 2026-10-03.

| Owner | Model | Android | API | ABI | Display |
|---|---|---|---|---|---|
| Hudson | Motorola Edge 70 | 17 | 37 | `arm64-v8a` | 1220 × 2712, 480 dpi |
| Duda | Samsung Galaxy S23 Ultra (`SM-S918B`), One UI 8.5 | 16 | 36 | `arm64-v8a` | 1080 × 2316 (FHD+ setting), 450 dpi |

Both are 64-bit ARM, so a release build targets `arm64-v8a` only
(`spec/05-architecture.md` §8). Both are on Android 14 or later.

## Connecting a phone

1. Developer options on (tap the build number seven times), then
   **USB debugging** on.
2. Use a data cable. A charge-only cable shows nothing at all: the PC does
   not even list an unknown device.
3. Unlock the screen, plug in, and set USB to **File transfer**, controlled by
   **this device**.
4. Accept **Allow USB debugging?** with "Always allow from this computer".
   Until then `adb devices` lists the phone as `unauthorized`.

On the Samsung, **Auto Blocker** (Settings → Security and privacy) must be
off first. While it is on, the USB debugging switch is locked, the cable
carries power only, and apps from outside the store cannot be installed — so
it stays off whenever this phone is used for a build.

`adb devices` should list each phone as `device`.
