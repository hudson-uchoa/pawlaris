# Local Android builds

Build on Windows with the pinned Expo SDK and Android tools. No Expo account,
EAS cloud build, Docker or paid service is needed. Commands below use
PowerShell 5.1: run one command at a time and stop on a non-zero exit.
Start at `C:\Hudson\Pawlaris` unless another directory is shown.

**Current blocker (2026-10-03):** the first P0-6 native build fails because
the P0-5 lockfile resolves Reanimated 4.7.1 alongside the Worklets 0.10.1
override. The native compatibility check rejects that pair. Q-3 in
`spec/QUESTIONS.md` asks the orchestrator to authorize aligning the existing
peer configuration. The commands below are the build procedure; successful
installation and launch on either phone remain unverified until that is fixed.

## Prerequisites

- Node 22 or later and pnpm; install the workspace with
  `pnpm install --frozen-lockfile`.
- JDK 17, with `JAVA_HOME` pointing at that JDK and its `bin` on `PATH`.
- Android Studio and its SDK Manager. `ANDROID_HOME` is `C:\Android\Sdk`;
  put `%ANDROID_HOME%\platform-tools` on `PATH`. Install the SDK platform,
  Build Tools, NDK (side by side) and CMake versions requested by the pinned
  Expo/React Native build. Accept the SDK licences in Android Studio. The first
  build downloads Gradle and native dependencies, so it needs internet.
  The first P0-6 build selected SDK platform 36, Build Tools 36.0.0 (and
  installed 35.0.0 for a dependency), and NDK 27.1.12297006, using the generated
  Gradle 9.3.1 wrapper.
- Keep the repository and SDK paths free of spaces. Do not move the SDK back
  under the default Windows user profile path.
- The phones in [devices.md](devices.md), connected by data cables, unlocked,
  with USB debugging authorized. On the Samsung, turn off Auto Blocker as
  described there. Both phones use `arm64-v8a`.
- For the LAN API: native PostgreSQL 16 and the owner's git-ignored
  `services/api/.env`, as described by H1/H2 in `spec/08-tasks.md`.

```powershell
node scripts/doctor.mjs
adb devices -l
```

`adb devices` prints each phone's serial; replace `<serial>` locally with
that value. Keep serials and the PC's LAN address out of repository evidence.

The Android checks must be `OK`; each phone must be `device`, rather than
`unauthorized` or `offline`. Maestro is not needed for a local build.

## API on the LAN

Use the PC and phones on the same trusted home network. Find the PC's IPv4
address on its Ethernet or Wi-Fi adapter; use that address rather than a VPN
address or `localhost` (which would mean the phone).

```powershell
Get-NetIPAddress -AddressFamily IPv4
uv run --directory services/api uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The API command keeps that terminal busy. In another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health
```

Allow TCP 8000 through Windows Firewall on the trusted network. In an
**administrator PowerShell** terminal, run this once:

```powershell
New-NetFirewallRule -DisplayName 'Pawlaris dev API' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Private -RemoteAddress LocalSubnet
```

The adapter must use the Private network profile. In each phone's browser,
open `http://<PC-LAN-IP>:8000/api/v1/health`; expect `status: ok` and `db: true`.
Port 5432 is not needed by the phones. Remove the rule when it is no longer
needed with `Remove-NetFirewallRule -DisplayName 'Pawlaris dev API'`.

## Development client

`expo-dev-client` is already pinned in `apps/mobile/package.json`. Set the API
URL before both prebuild and Metro startup. Replace `<PC-LAN-IP>` with the
PC's current LAN address.

```powershell
Set-Location C:\Hudson\Pawlaris\apps\mobile
$env:EXPO_PUBLIC_API_URL = 'http://<PC-LAN-IP>:8000/api/v1'
npx expo run:android --device motorola_edge_70
```

This generates the ignored `android/` project, compiles the debug APK,
installs it on Hudson's phone and starts Metro on port 8081. Keep Metro running.
In a second terminal with the same API URL:

```powershell
Set-Location C:\Hudson\Pawlaris\apps\mobile
$env:EXPO_PUBLIC_API_URL = 'http://<PC-LAN-IP>:8000/api/v1'
npx expo run:android --device SM_S918B --no-bundler
```

The pinned SDK 57 CLI accepts the model names above for `--device`. Use
`--device` without a value to choose interactively when a model changes. ADB's
`-s` option uses the serial from `adb devices`, not the Expo model name.

For later JavaScript-only work, reuse the installed client:

```powershell
npx expo start --dev-client --lan
```

Metro may choose the VPN adapter. USB avoids that and the need to open its
port in the firewall. Start Metro with `--localhost` instead of `--lan`, then
in another terminal run these commands once per phone, using its serial:

```powershell
adb -s <serial> reverse tcp:8081 tcp:8081
adb -s <serial> shell am start -a android.intent.action.VIEW -d 'exp+pawlaris://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' app.pawlaris
```

The API still uses the LAN URL; this forwards only Metro. For cable-free
development, allow TCP 8081 with a separate Private/LocalSubnet firewall rule
like the API rule, and open the LAN Metro URL in the development launcher.

Rebuild after adding a native dependency or changing native app configuration.
If `android/` already exists, regenerate it before rebuilding:

```powershell
npx expo prebuild --platform android --clean
npx expo run:android --device motorola_edge_70
```

`--clean` replaces the generated native project. Keep maintained configuration
in `app.config.ts` and config plugins. The API URL determines native HTTP
permission: `http://` enables cleartext traffic through `expo-build-properties`;
`https://` leaves it disabled. Regenerate when switching between these schemes.
Restart Metro after changing the URL. The P0 scaffold shows only the Pawlaris
name; API calls and the replica arrive in later tasks.

## Release build, ARM64 only

Build the embedded JavaScript bundle and native APK locally:

```powershell
Set-Location C:\Hudson\Pawlaris\apps\mobile
$env:EXPO_PUBLIC_API_URL = 'https://<BOX-HOST>/api/v1'
npx expo prebuild --platform android --clean
Set-Location android
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The APK is `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
The explicit Gradle property restricts native libraries to `arm64-v8a`.
For a local release run on a selected ARM64 phone, Expo also supports
`npx expo run:android --variant release --device motorola_edge_70`.

At P0-6, Expo's generated release variant still uses the development signing
key. It is a local release-mode preview. P8-5 adds the owner's release signing
configuration, read from the environment, and the signed APK distribution
check. Do not hand-edit the generated signing block as a persistent setup.
The APK is embedded and does not need Metro. Switch back to the development
API URL and regenerate the native project before resuming HTTP development.

## Owner: create the release keystore (H9)

Run this yourself in an interactive PowerShell terminal. The signing directory
is outside the repository. `keytool` prompts for passwords; keep the resulting
keystore, alias and passwords in the password manager.

```powershell
New-Item -ItemType Directory -Force C:\Hudson\Pawlaris-signing
keytool -genkeypair -v -storetype PKCS12 -keystore C:\Hudson\Pawlaris-signing\pawlaris-release.keystore -alias pawlaris-release -keyalg RSA -keysize 4096 -validity 10000
```

Use the same key for subsequent releases so Android accepts upgrades.
When switching between the final release key and the dev key, first drain the
outbox, then uninstall the existing build before installing the new one.
Uninstalling deletes that phone's local data.

## Common failures

| Symptom | Fix |
|---|---|
| `pnpm.ps1` or `npx.ps1` is blocked | Use `pnpm.cmd` or `npx.cmd` with the same arguments. |
| No phone, or `unauthorized` | Follow [devices.md](devices.md): data cable, USB mode, unlock, authorization; Samsung Auto Blocker off. |
| `Could not find device with name` | Give Expo the model name or choose with `--device`; use the serial only for `adb -s`. |
| Java or Gradle version error | Check `java -version` and `JAVA_HOME`; use JDK 17 and the generated Gradle wrapper. |
| SDK/NDK/CMake missing or licence rejected | Install the exact version named in the build output using SDK Manager and accept its licence. Keep `ANDROID_HOME` at `C:\Android\Sdk`. |
| CMake/NDK cannot read a path | Check the repository, SDK and native build cache paths for spaces. If Gradle's cache is implicated, set `GRADLE_USER_HOME` to a writable path without spaces before restarting the build. |
| Gradle download or dependency resolution fails | Check internet/proxy access to Google's Maven repository, Maven Central and the Gradle distribution host; retry the same build. |
| `:react-native-reanimated:assertWorkletsVersionTask` fails | The existing peer versions disagree. Follow Q-3 in `spec/QUESTIONS.md`; do not bypass the native compatibility check. |
| App cannot reach Metro | Keep Metro running; use the USB reverse commands above, or the correct LAN adapter, port 8081 firewall rule and matching Wi-Fi. |
| API unreachable from the phone | Check the PC IP, Private firewall rule, Uvicorn's `0.0.0.0` binding and phone Wi-Fi. Check `/health` in the phone browser. |
| `CLEARTEXT ... not permitted` | Set the HTTP dev API URL, regenerate with `prebuild --clean`, rebuild, then restart Metro with that URL. |
| App still uses an old URL or native dependency | Restart Metro for JavaScript/env changes; regenerate and rebuild for native changes. |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | The installed app has another signing key. Drain the outbox before the owner uninstalls it and installs the desired APK. |

Device results and screenshots belong in [evidence/P0-6.md](evidence/P0-6.md).

References: [Expo local development builds](https://docs.expo.dev/develop/development-builds/introduction/?buildenv=build-locally),
[Expo CLI build variants](https://docs.expo.dev/more/expo-cli/#compiling-android),
and [Android app signing](https://developer.android.com/studio/publish/app-signing).
