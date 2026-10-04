# Navigation runtime asset licences

The app supplies no image, icon or font assets in P0-5. The required Expo
Router native stack includes its own internal assets in the Android
export. Their scope under the product asset rule is recorded in Q-2 in
`spec/QUESTIONS.md`.

| Runtime assets | Package | Licence |
|---|---|---|
| Navigation and router status icons | `expo-router` 57.0.24 | MIT |
| `MaterialSymbols_400Regular.ttf` | `@expo-google-fonts/material-symbols` 0.4.48 | Apache-2.0 for the font; MIT for the Expo package |

The pinned packages contain their licence texts. The Material Symbols
package carries `LICENSE` (Expo's MIT licence) and `LICENSE_FONT`
(Apache-2.0). These are framework assets; the Pawlaris screen does not
select this font or render icons from this set.

The product font, icon set and authored visuals will be added by their
own tasks, with their licences recorded here.

## Development client runtime assets (P0-6)

`expo-dev-client` 57.0.19 brings the development launcher and menu. Their
Android debug resources are tools' internal UI; Pawlaris components do not
select them.

| Runtime assets | Package | Licence |
|---|---|---|
| Launcher branch, extension and update icons | `expo-dev-launcher` 57.0.20 | MIT (package `LICENSE`) |
| Developer menu button and vector resources | `expo-dev-menu` 57.0.18 | MIT (package `LICENSE`) |
| `jetbrains_mono_{light,regular,medium}.ttf` | `expo-dev-menu` 57.0.18 | SIL Open Font License 1.1; JetBrains Mono Project Authors |
| `inter_{regular,medium,semibold,bold}.ttf` | `expo-dev-menu` 57.0.18 | SIL Open Font License 1.1; Inter Project Authors |

Font licence references: [JetBrains Mono OFL](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt)
and [Inter OFL](https://github.com/rsms/inter/blob/master/LICENSE.txt).
