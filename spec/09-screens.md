# 09 — Screens and Flows

What the finished app looks like and does, screen by screen. Requirements are in
`02-spec.md`; the identity, tokens and motion in `06-ux-motion-spec.md`; data access in
`10-client-sync.md`. All user-facing text is pt-BR and lives in
`apps/mobile/src/i18n/strings.ts` — components never contain literal copy.

Every interactive element named here carries the `testID` shown in `code`.
Maestro flows and component tests select by those ids, never by text.

---

## 1. Route map

```
app/_layout.tsx                    providers, startup, auth gate
app/(auth)/login.tsx
app/(auth)/redeem.tsx
app/(tabs)/_layout.tsx             4 tabs + SyncIndicator
app/(tabs)/index.tsx               Hoje
app/(tabs)/pets.tsx                Pets
app/(tabs)/walks.tsx               Passeios
app/(tabs)/settings.tsx            Ajustes
app/pet/new.tsx                    modal
app/pet/[id]/index.tsx             profile (hero target)
app/pet/[id]/edit.tsx              modal
app/pet/[id]/weight.tsx            modal — new weight
app/pet/[id]/health/new.tsx        modal
app/health/[id].tsx                modal — edit health event
app/tasks/index.tsx                all templates: Ativas / Encerradas
app/task/new.tsx                   modal
app/task/[id]/index.tsx            detail + history
app/task/[id]/edit.tsx             modal
app/camera.tsx                     full-screen modal
app/walk/live.tsx
app/walk/[id].tsx
app/settings/family.tsx
app/settings/password.tsx
app/settings/permissions.tsx
app/settings/diagnostics.tsx
app/permission/notifications.tsx   rationale
app/permission/location.tsx        rationale ladder
```

Forms are modal routes (native stack, `presentation: 'modal'`). Short choices
(confirmations, pickers with a handful of options) use the `Sheet` primitive.

### Startup sequence

```
1. open SQLite, run migrations                      (sync)
2. read kv.session_user
3. no session  → render (auth)/login
   session     → hydrate replica (sync) → render (tabs)/index from memory
                 → engine.kick('start') → notifications.reconcile()
                 → walks.recoverIfNeeded()           (§8.3)
```

Nothing in steps 1–3 awaits the network. The splash screen hides on the first
layout of the dashboard.

---

## 2. Auth

### 2.1 Login — `(auth)/login`

- Full-screen `Starfield` behind the form, with the paw-star mark and the name
  "Pawlaris" above it.
- Fields: email `login-email`, senha `login-password`. Button **Entrar**
  `login-submit`. Link **Tenho um convite** `login-to-redeem`.
- Submit → `POST /auth/login`. Button shows an inline progress state; the form
  stays visible.
- Errors, shown under the form: 401 → "E-mail ou senha incorretos."; 429 →
  "Muitas tentativas. Tente de novo em N min." (from `Retry-After`); network →
  "Sem conexão. O primeiro acesso precisa de internet."
- Success → store session → first pull. While the replica is empty the tabs
  render skeletons *(R6.1)*.
- When the session expired with a non-empty outbox, a note sits above the
  form: "Você tem N alterações esperando para sincronizar. Entre para enviá-las."

### 2.2 Redeem — `(auth)/redeem`

- Fields: código `redeem-code` (auto-uppercase, 10 chars), nome
  `redeem-name`, e-mail `redeem-email`, senha `redeem-password` (min 8).
  Button **Criar conta** `redeem-submit`.
- Errors: 410 → "Convite inválido ou expirado."; 409 → "Este e-mail já está em uso."

---

## 3. Hoje — `(tabs)/index`

The screen that matters. Data: `selectDayView(state, { date, now, me, scope })`
in `apps/mobile/src/replica/selectors.ts`, which wraps `buildDayView` from
`packages/shared/src/dayView.ts`. The list is a Reanimated `Animated.FlatList`
*(06 §1.3)*.

### 3.1 Layout, top to bottom

1. **Header** — the day label and the sync indicator, over a `Starfield` band
   *(06 §4.1)* that parallaxes with the list's scroll.
   - Label: `Hoje`, `Ontem`, `Amanhã`, otherwise `qua., 14 de out.`
   - `day-prev` / `day-next` chevrons move one day; limits −90 / +30 *(R6.2)*.
     Tapping the label when it is not today returns to today (`day-today`).
   - `SyncIndicator` `sync-indicator` on the right.
2. **Scope filter** (leaders only, `scope-filter`) — chips: `Minhas` `scope-mine`,
   `Todas` `scope-all`, then one per other enabled member `scope-user-<id>`
   *(R6.11)*.
3. **Walk banner** (only when another member has an `active` walk younger than
   12 h): "Hudson está passeando com a Katarina desde 18:02" `walk-banner`.
4. **Próximos cuidados** (today only, only when non-empty) — health events with
   `next_due_on` within the next 7 days or overdue: pet avatar, title,
   "vence em 3 dias" / "vence hoje" / "venceu há 2 dias". Tap → pet profile.
5. **Atrasadas** — section header in `danger` color with a count.
6. **Agora**
7. **Mais tarde**
8. **Concluídas (n)** `section-done` — collapsed by default; tap to expand.
9. Empty section headers are not rendered.

Bottom-right FAB **+** `task-add` → `task/new`. A header action **Tarefas**
`tasks-manage` → `tasks/index`.

### 3.2 States

| State | What shows |
|---|---|
| Replica not ready or empty before the first pull | 5 skeleton cards |
| No occurrences in scope for the day | `EmptyState` with the crescent scene *(06 §4.10)*: "Céu limpo por hoje." + button "Criar tarefa" |
| All complete, at least one existed, today | shooting stars once *(R6.13, 06 §4.5)*; the header reads "Céu completo"; then the collapsed Concluídas |
| Past day | no Agora/Mais tarde; incomplete items under Atrasadas |
| Future day | everything under Mais tarde, checkboxes disabled *(R3.26)* |

### 3.3 TaskCard — `task-card-<taskId>-<occurrenceKey>`

```
┌──────────────────────────────────────────────────────────┐
│ ◉◉  Remédio da Aurora                          08:00   ☐ │
│     Duda · crítico                                       │
│     [Aurora ☐] [Asteria ☑ Duda 08:02]      2/4           │  ← per_pet only
└──────────────────────────────────────────────────────────┘
```

- **Avatars:** up to 3 overlapping pet avatars, then `+n`.
- **Title**, one line, ellipsized.
- **Time:** `HH:mm`; all-day occurrences show `hoje`. A carry-over *(R6.5)*
  shows its original date: `seg., 12/10`.
- **Meta line:** assignee when it is not the viewer (`Duda`), or `Qualquer um`
  for unassigned *(R6.12)*; a camera glyph when `requires_photo`; a clock glyph
  when `timer_seconds` is set.
- **Checkbox** — a `StarCheck` *(06 §4.2)* — `task-check-<taskId>-<occurrenceKey>` (`together` mode) — or one
  **pet toggle** per pet `task-pet-<taskId>-<occurrenceKey>-<petId>` plus the
  `n/m` progress (`per_pet` mode). A `per_pet` card has no master checkbox.
- **Done line:** `Duda · 08:02` in the member's color. With a photo, a
  thumbnail on the right that opens it full-screen.
- Tap on the card body → `task/[id]`.

**Interaction** *(R3.18–R3.23)*:

| Gesture | Result |
|---|---|
| press-in on an unchecked box | scale feedback only |
| release on an unchecked box, no photo required | `createCompletion` → the star lights + haptic → after 400 ms the card moves to Concluídas |
| release, `requires_photo` | open `camera` with the occurrence as param; on capture, complete; on cancel, nothing |
| release on a checked box | `Sheet`: "Desfazer? Feito por Duda às 08:02." — **Desfazer** `undo-confirm` / **Cancelar** |
| long-press on the card, template has `timer_seconds` | start the timer *(§5.3)* |
| event `completion_lost` for this occurrence | attribution crossfades to the winner; toast "Duda já tinha feito às 07:12" |

A failed sync never un-checks a card. The only visible sign is the indicator.

---

## 4. Pets

### 4.1 Grid — `(tabs)/pets`

- Two-column grid of non-archived pets ordered by `sort_order`, then name.
  Card `pet-card-<id>`: avatar (or species glyph on the pet's accent color),
  name, age *(R2.4)*.
- Press-in → scale; release → hero transition to `pet/[id]` *(06 §4.6)*.
- **+ Adicionar** `pet-add` → `pet/new`.
- Leaders see **Arquivados (n)** `pets-archived` at the bottom, expanding a list
  with **Desarquivar**.
- Empty: the unlit-constellation scene *(06 §4.10)*, "Nenhuma estrela por aqui ainda." + **Adicionar pet**.

### 4.2 Pet form — `pet/new`, `pet/[id]/edit`

Fields: foto `pet-avatar` (opens `camera` in avatar mode, or the gallery picker),
nome* `pet-name`, espécie* `pet-species` (Gato / Cachorro — fixed after
creation), sexo, raça, cor, nascimento (date picker), microchip, observações.
**Salvar** `pet-save` → `createPet` / `patchPet` → close. Validation is local
and inline: "Informe o nome."

Edit adds, for leaders, **Arquivar pet** `pet-archive` with a confirmation
sheet: "A Aurora sai das tarefas e da lista. O histórico continua guardado."

### 4.3 Profile — `pet/[id]`

1. **Header** (hero target), over a `Starfield` band: large avatar inside its
   orbit ring *(06 §4.4)*, name, `Gata · 3 anos · SRD`. **Editar** `pet-edit`.
2. **Peso** — latest value (`4,25 kg`), the trend chart `weight-chart`
   *(06 §6)*, **Registrar peso** `weight-add` → `pet/[id]/weight`. Under the
   chart, the 5 most recent entries; swipe-left or long-press an entry →
   **Excluir**.
3. **Cuidados de hoje** — that pet's occurrences for today, as compact rows
   (any assignee): the cross-check that lets one person confirm the other gave
   the dose *(R1.19)*.
4. **Saúde** — timeline *(R2.12)*: month headers, items with type glyph, title,
   date, `próxima: 12/11` when `next_due_on` is set, attachment thumbnail.
   **Adicionar** `health-add` → `pet/[id]/health/new`. Tap an item → `health/[id]`.
5. **Passeios** (dogs only) — the 3 most recent walks, **Ver todos** → Passeios tab.

Weight form: peso (decimal keyboard, comma accepted) `weight-value`, data/hora
(defaults to now), observação. **Salvar** `weight-save`. The 20% rule *(R2.7)*
shows a sheet before saving: "2,00 kg → 12,00 kg — está certo?" **Sim, salvar**
`weight-confirm` / **Corrigir**.

Health form: tipo (chips), título*, quando (defaults to now), próxima data
(optional), observações, foto (optional). **Salvar** `health-save`. Edit adds
**Excluir**.

---

## 5. Tasks

### 5.1 Task form — `task/new`, `task/[id]/edit`

One screen, sections in this order:

| Field | Control | Notes |
|---|---|---|
| Título* `task-title` | text | |
| Categoria `task-category` | chips | choosing **Remédio** presets Por pet + Crítico *(R3.5)* |
| Pets* `task-pets` | avatar chips, multi-select | at least one; archived pets not offered |
| Modo `task-mode` | `Uma vez para todos` / `Uma vez por pet` | hidden when one pet is selected (stored as `together`) |
| Repetição `task-freq` | `Todo dia` · `Semanal` · `Mensal` · `Uma vez` | |
| — intervalo | stepper "a cada N dias/semanas/meses" | not for Uma vez |
| — dias da semana | 7 toggles `S T Q Q S S D` (Mon first) | Semanal |
| — dias do mês | grid 1–31, multi-select | Mensal |
| — data | date picker | Uma vez |
| Horários `task-times` | list of time chips + **Adicionar horário**; empty = "o dia todo" | max 8 |
| Começa em `task-starts` | date picker, default today | new tasks only |
| Responsável `task-assignee` | `Qualquer um` · me · other members | others enabled for leaders only *(R3.3)* |
| Exigir foto `task-photo` | switch | |
| Cronômetro `task-timer` | off, or minutes | |
| Lembrete `task-reminder` | `Normal` / `Crítico` | |
| Descrição | multiline | |

**Salvar** `task-save`:

- New → `createTask`.
- Edit, only cosmetic fields changed → `patchTask`.
- Edit, any schedule field changed → `forkTask` *(R3.8)*. Before saving, a note
  appears above the button: "As mudanças de agenda valem a partir de hoje." or
  "… a partir de amanhã, porque a tarefa de hoje já foi marcada."

Edit also offers **Encerrar tarefa** `task-end` *(R3.9)* — sheet: "A tarefa para
de aparecer. O histórico fica." — and, only when the template has no
completions in the replica, **Excluir** `task-delete` *(R3.10)*.

**Every form validates locally with the server's limits** before it enqueues
anything — lengths, ranges and required fields come from the validators in
`packages/shared/src/validators.ts`, which mirror `03` (name 1–40, title 1–80,
weight 0.01–119.99 with two decimals, password 8–128, …). A mutation the
server would refuse must never reach the outbox from a form.

A member opening a template they did not create sees the form read-only with
the note "Só quem criou ou um líder pode editar."

### 5.2 Manage — `tasks/index`

Two segments: **Ativas** (no `ends_on`, or `ends_on ≥ today`) and
**Encerradas**. Row: title, pets, a human summary of the schedule
(`Todo dia · 08:00, 20:00`, `Seg, qua, sex · 07:00`, `Dias 1 e 15 · o dia todo`,
`Uma vez · 03/10`), assignee. Tap → `task/[id]`.

### 5.3 Detail — `task/[id]`

1. Title, category, schedule summary, pets, assignee. **Editar** `task-edit`.
2. **Hoje** — today's occurrences of this template as TaskCards.
3. **Cronômetro** (when `timer_seconds` is set): the ring *(06 §4.4)*,
   **Iniciar** `timer-start` / **Cancelar** `timer-cancel`. A timer started by
   the other member shows as running with "iniciado por Duda".
4. **Histórico** — the last 30 days, newest first: date, slot, and per row
   either `Duda · 08:02` (with photo thumbnail) or `não feito`. Undone
   completions are not listed. Scrolling past 30 days loads older ranges from
   SQLite, 30 days at a time, down to 90.

### 5.4 Camera — `camera`

Full-screen `expo-camera` preview, back camera, shutter `camera-shutter`,
**Cancelar** `camera-cancel`. After capture: preview with **Usar foto**
`camera-use` / **Tirar outra**. On use: compress → write the file → register
`asset_file` → return the asset id to the caller *(10 §7)*. Camera permission is
requested here, with an inline explanation if denied and a button to Settings.

Photo state under a thumbnail *(R3.46)*: `enviando…` while queued, no label once
sent, `falhou — toque para tentar de novo` `photo-retry`, `foto a caminho` on
the other phone.

The camera has three modes: `avatar` (1024 px, quality 0.8), `proof` and
`attachment` (both 1600 px, quality 0.7). The health form uses `attachment`.

---

## 6. Walks

### 6.1 Passeios — `(tabs)/walks`

- CTA `walk-start`: **Passear com a Katarina** when the family has exactly one
  non-archived dog; **Iniciar passeio** opening a dog picker otherwise; hidden,
  with "Nenhum cachorro cadastrado.", when there is none.
- Below the CTA, the `PermissionGate` state *(§8.1)* when it is not `granted`.
- A resumable walk on this device replaces the CTA with **Continuar passeio**
  `walk-resume`.
- History: finished walks, newest first — date, `2,14 km · 30 min · 14:15 /km`,
  the route thumbnail (SVG polyline, no map tiles), walker's name. Tap →
  `walk/[id]`.
- A walk of another member, `active` and older than 12 h, is listed as
  "Passeio interrompido" with **Descartar** for leaders *(R4.17, R4.18)*.

### 6.2 Live — `walk/live`

```
┌────────────────────────────┐
│          [ map ]           │   route so far; camera follows; without tiles the line still draws on the plain background
├────────────────────────────┤
│   2,14 km                  │   distance — rolling digits
│   30:12   14:15 /km  4,2 km/h │   elapsed · average pace ('--' under 0,5 m/s) · current speed
│   ● sinal bom              │   fix pulse; "sinal fraco" when acc > 30 m; "sem sinal" after 15 s without a fix
├────────────────────────────┤
│   [ Pausar ]   [ Encerrar ]│   walk-pause / walk-finish
└────────────────────────────┘
```

- **Pausar** ↔ **Continuar** `walk-resume-live`. While paused the metrics panel
  dims *(06 §4.9)* and incoming points are flagged `paused`.
- **Encerrar** → sheet "Encerrar o passeio?" → `finishWalk` → `walk/[id]`. A
  walk under 20 m or 30 s offers **Descartar** as the primary action instead.
- System back while a walk is active does not end it: the walk keeps recording
  and Passeios shows **Continuar passeio**.
- When the walk is running in tracking mode `foreground` *(§8.1)*, a persistent
  banner: "Neste celular o rastreio só funciona com o app aberto. Toque para
  permitir o tempo todo." It never appears in the normal `service` mode.

### 6.3 Detail — `walk/[id]`

Map with the full route (loaded from `walk_route_cache`, else
`GET /walks/{id}/route`, with a skeleton over the map area only), then
distance, duration, pace, start/end time, walker, note. If the route cannot be
loaded offline: "Rota disponível quando houver conexão." The metrics always
show. **Descartar** `walk-discard` for the walker or a leader.

---

## 7. Ajustes — `(tabs)/settings`

Rows: **Família** → `settings/family` · **Trocar senha** → `settings/password` ·
**Permissões** → `settings/permissions` · **Diagnóstico** →
`settings/diagnostics` · **Sair** `logout`.

- **Família:** family name and timezone (both editable by leaders; the
  timezone from a short list headed by `America/Sao_Paulo`, with a search over
  the IANA names), members list with role badge and color dot. For leaders: role toggle per member, **Remover**, and
  **Convidar** `invite-create` → role choice → shows the code large, with
  **Copiar** and "Vale por 24 horas, para uma pessoa.". All disabled offline with
  the note "Disponível quando houver conexão."
- **Trocar senha:** senha atual, nova senha (min 8), **Salvar**. Online only.
- **Permissões:** one row per permission with its live state and a button that
  either requests it or opens system Settings: Notificações, Localização,
  Localização em segundo plano, Otimização de bateria, Câmera.
- **Diagnóstico** *(R7.2–R7.4)*: every value in R7.2 as label/value rows;
  dead letters as an expandable list (method, path, status, error, when);
  buttons **Sincronizar agora** `diag-sync`, **Autoteste** `diag-selftest`
  (runs the recurrence and time vectors on-device and shows `42/42 ok` or the
  failing names), **Reconstruir dados locais** `diag-rebuild`, **Exportar
  registros** `diag-export` (share sheet with a `.txt`).
- **Sair:** with a non-empty outbox, sheet "N alterações ainda não foram
  enviadas e serão perdidas. Sair mesmo assim?"

---

## 8. Permissions

### 8.1 Location state *(R4.3, R4.4)*

```ts
type LocationState = 'granted' | 'approximate' | 'denied' | 'blocked';
type TrackingMode  = 'service' | 'foreground';
```

| Foreground permission | Accuracy granted | State |
|---|---|---|
| granted | `fine` | `granted` |
| granted | `coarse` (the user chose "Aproximada") | `approximate` |
| not granted, can ask again | — | `denied` |
| not granted, cannot ask again | — | `blocked` |

`PermissionGate` renders by state: `granted` → children; `approximate` →
"Para medir o passeio, o Pawlaris precisa da localização **precisa**." +
**Abrir configurações**; `denied` → explanation + **Permitir localização**;
`blocked` → explanation + **Abrir configurações**. Re-evaluated on every app
foreground.

**Tracking mode** is decided when a walk starts *(R4.3)*:

```
try startLocationUpdatesAsync with a foreground service        → mode 'service'
if it throws for lack of background permission:
    kv.needs_background_location = '1'
    show the "O tempo todo" step (§8.2, step 3b); if granted → retry → mode 'service'
    otherwise watchPositionAsync                                → mode 'foreground' + the banner of §6.2
```

The expected path on every supported Android version is `service` on the first
try. The fallback exists so that a phone that behaves differently records
honestly instead of failing.

### 8.2 Location ladder — `permission/location`

Shown the first time the user taps the walk CTA without `granted`. One step per
screen, each with a short reason and a single primary button:

1. **Localização** — "Para medir a distância e desenhar a rota do passeio.
   Escolha *Precisa*." → system dialog.
2. **Notificações** (Android 13+, if not granted) — "O Android exige uma
   notificação visível enquanto o passeio é gravado."
3. **Bateria** (once, `kv.battery_prompt_done`) — "Alguns celulares encerram
   apps em segundo plano. Desative a otimização de bateria para o Pawlaris." →
   battery-optimization settings, plus two lines of manufacturer-specific help
   chosen by `Device.manufacturer` (Xiaomi, Samsung, Motorola, other).

Step **3b — O tempo todo** is shown only when `kv.needs_background_location`
is set: "Neste celular, gravar com a tela bloqueada exige *Permitir o tempo
todo*." → system Settings. **Agora não** records in mode `foreground`.

### 8.3 Walk recovery *(R4.6)*

At startup and on foreground: if `local_walk` has a row and tracking is not
running → sheet "Você tem um passeio em andamento, iniciado às 18:02 (1,2 km)."
**Continuar** (restart tracking, keep points) / **Encerrar com o que temos**
(`finishWalk` with the stored points, `ended_at` = last point's time).

### 8.4 Notifications — `permission/notifications`

Shown after the first task is created or first sync brings a template with a
time, if `POST_NOTIFICATIONS` is not granted *(R3.37)*: "Para lembrar dos
horários e avisar quando alguém da família concluir uma tarefa." **Ativar
lembretes** → system dialog. **Agora não** → never auto-shown again; reachable
from Ajustes → Permissões.

---

## 9. Notifications

### 9.1 Channels (created at startup)

| Channel id | Name shown in Android | Importance |
|---|---|---|
| `reminders-critical` | Lembretes críticos | HIGH, sound, vibration |
| `reminders-routine` | Lembretes | DEFAULT |
| `timers` | Cronômetros | HIGH, sound |
| `family-activity` | Atividade da família | DEFAULT |

The walk-tracking notification uses the channel `expo-location` creates.

### 9.2 Local notifications and their ids

| Kind | Identifier | Fires at | Text |
|---|---|---|---|
| Task reminder | `rem:<taskId>:<occurrenceKey>` | the slot instant | title = task title; body = pet names joined (`Aurora, Asteria`) |
| Health due | `due:<healthEventId>` | 09:00 family time on `next_due_on` | title = event title; body = `<Pet> — vence hoje` |
| Timer | `tmr:<timerId>` | `ends_at` | title = `Tempo esgotado`; body = task title |

Each carries `data: { kind, taskId?, occurrenceKey?, date?, petId?, fp }` where
`fp` is a fingerprint of fire time + text, used by the reconciler.

### 9.3 Planner and reconciler

`planReminders({ now, tz, me, templates, completions, pets, healthEvents,
timers })` in `packages/shared/src/reminders.ts` is pure and returns the
**desired set**:

- task reminders: every occurrence in `[today, today + 7 days]` that has a time,
  fires after `now`, belongs to a template assigned to `me` or to nobody, and is
  not fully complete *(R3.32–R3.34)*; if more than 200, the 200 soonest
- health dues: `next_due_on` within 30 days, fire instant after `now`
- timers: not cancelled, `started_by = me`, `ends_at > now`

`reconcile()` in `apps/mobile/src/notifications/` compares the desired set with
`getAllScheduledNotificationsAsync()` filtered to our three prefixes: cancels
ids not desired, schedules ids missing, and re-schedules ids whose `fp`
differs. It is idempotent and runs on app foreground, after every pull that
applied changes, and after every `enqueue` touching templates, completions,
health events or timers.

### 9.4 Push handling *(R3.39–R3.43)*

- **Token:** after login and on every foreground, get the Expo push token and
  `PUT /me/push-token` when it differs from the last one sent.
- **App in foreground:** one global notification handler decides by kind. A
  **push** (`family-activity`) is not shown as a banner; an in-app toast shows
  the same text, and the poke socket already triggered the pull. A **local**
  notification (`rem:`, `due:`, `tmr:`) is shown normally — a reminder must
  appear even while the app is open.
- **App in background or dead:** Android shows the visible message. The
  data-only message runs a background task (registered at module scope with
  `expo-task-manager`) that cancels `rem:<task_id>:<occurrence_key>` when the
  template is `together`; for `per_pet` it does nothing (the next reconcile
  decides). It also appends that id to `kv.suppressed_reminders`, because the
  replica does not know about the completion yet: `planReminders` leaves out
  suppressed ids, so opening the app offline does not re-schedule the reminder.
  The list is cleared after the next pull that applies changes. The task does
  no network and no sync.
- **Tap** on a reminder or an activity push → open `(tabs)/index` on the
  occurrence's date *(R3.38)*; on a `walk_started` push → Passeios.

Background delivery of data-only messages is best effort on Android (a
force-stopped app receives nothing). The visible message does not depend on it.

---

## 10. Copy

Formatting helpers in `apps/mobile/src/i18n/format.ts`:

| Thing | Format | Example |
|---|---|---|
| Time | `HH:mm` | `07:12` |
| Short date | `dd/MM` | `03/10` |
| Day label | weekday abbr., day, month abbr. | `sáb., 3 de out.` |
| Decimal | comma | `4,25 kg`, `2,14 km` |
| Distance | `< 1000 m` → `850 m`; else `2,14 km` | |
| Duration | `< 1 h` → `30:12`; else `1:05:12` | |
| Pace | `mm:ss /km` | `14:15 /km` |
| Age | per R2.4 | `1 ano e 4 meses` |

Push body templates (server-side, `04` §15):

| Event | Title | Body |
|---|---|---|
| completion | `<Nome>` | `concluiu "<título>" às <HH:mm>` — `per_pet`: `concluiu "<título>" (<pet>) às <HH:mm>` |
| completion_duplicate | `<Nome>` | `também marcou "<título>"` |
| walk_started | `<Nome>` | `saiu para passear com <pet>` |

The sky is in the visuals, not in the instructions: labels, buttons, errors
and anything about medication stay plain and literal. Cosmic wording appears
only in the four empty states *(06 §4.10)* and in "Céu completo".

Standard toasts: `Duda já tinha feito às 07:12` · `Uma alteração não pôde ser
aplicada` · `Sem conexão — suas alterações serão enviadas depois` (first
offline mutation of a session only) · `Peso registrado` · `Passeio salvo`.
