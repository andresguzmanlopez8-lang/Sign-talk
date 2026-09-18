# SignBridge — Bidirectional Sign Language Translator

## Overview
Mobile app for bidirectional translation between Sign Language (LSM/ASL) and Spoken/Written language (Spanish/English). Real-time translation, WhatsApp-style OTP auth, dictionary with A-Z alphabet, camera-based sign capture and voice/text input.

## Stack
- Backend: FastAPI + MongoDB + emergentintegrations (OpenAI Whisper STT, OpenAI TTS, GPT-4o-mini)
- Frontend: Expo Router 57 (React Native 0.86), expo-camera, expo-audio, expo-contacts, expo-image-picker

## Features
1. **Auth (WhatsApp-style)**: Phone + country code + 6-digit OTP (MOCK: `123456`). JWT tokens.
2. **Onboarding**: Name, profile photo, preferred language (ES/EN).
3. **Permissions**: Camera, Mic, Contacts with fallback screen for denied perms.
4. **Translator tab**:
   - Sign→Text mode (REAL recognition, Phase 1 perf fix): camera preview isolated in memoized `src/components/SignCamera.tsx` (no re-render on parent state; autofocus off = locked while recording). Capture loop samples at 2.5 fps (400 ms) into a buffer (native takePicture + ImageManipulator 384px); analyzer loop sends ORDERED bursts of 3-4 frames to `POST /translate/sign-frame {frames[]}` (legacy `image_base64` still accepted) → OpenAI gpt-5.4 vision (emergentintegrations LlmChat + ImageContent) returns `{sign, confidence, motion: static|dynamic|none, frames_analyzed}` — the prompt evaluates the frames chronologically to distinguish static fingerspelling (W) from dynamic gestures (agua). Live overlay shows the detected sign + confidence (+🔁 when dynamic) and the running sequence (chips). Tap ⏹ to stop → `POST /translate/sign-to-text {signs}` composes the sentence deterministically (consecutive letters spell a word) and saves it; TTS plays it. No signs → toast 'No se detectó ninguna seña' and nothing is saved. All mock phrases removed.
   - Text/Voice→Sign mode: Text field or mic. Whisper transcribes voice. Result animated as ASL letter GIFs (avatar).
   - Chat history with WhatsApp-style bubbles. Language toggle LSM↔ASL.
5. **Dictionary tab**: 129 seeded entries (A-Z LSM + A-Z ASL + 38 everyday words each; seed upserts missing ids on startup). Search, A-Z filter chips, letter/word filter, detail modal with GIF + description.
6. **Profile tab**: Avatar/name/phone, edit profile, language preference, logout.
7. **Frases Favoritas**: ⭐ on any chat bubble saves the phrase; horizontal favorites row above the composer sends it again as Text→Sign in one tap (long-press removes).
8. **Modo Aprendizaje (Learn tab 🎓)**: Daily lesson of 5 signs (deterministic per user/day, prioritizes unlearned signs). 4-option quiz with feedback. Streak (🔥) counted once per day, resets if a day is skipped; best streak, learned count, lessons completed.
9. **Historial Exportable**: 📄 in translator header builds a printable PDF of the whole chat (expo-print). Native: share sheet via expo-sharing. Web: print dialog.
10. **Enviar a Contactos**: 📤 on any bubble opens ContactPicker bottom sheet (src/components/ContactPicker.tsx): contacts permission flow (check → explain → request → blocked → Open Settings), searchable contact list (expo-contacts), manual number fallback (web/denied). Send via WhatsApp (wa.me link) or SMS (sms: link). PDF → share sheet (WhatsApp appears there).
11. **Ilustraciones por palabra**: every word entry has an `emoji` field rendered as a large illustration in dictionary cards, detail modal and quiz (letters keep GIFs). Seed upserts all entries with `$set` on startup.
12. **Modo Repaso**: wrong answers (daily or review) are stored in `learning.weak_ids`; correct answers remove them. Learn tab shows a Review card with weak count; `GET /learn/review` builds a quiz (≤10) only from weak signs; `POST /learn/review/complete` updates weak list without touching the streak.
13. **Frases Completas**: 20 everyday phrases per language in 4 categories (static `PHRASES` list, `GET /phrases?language=`). Translator "💬 Frases" chip opens PhraseSheet (src/components/PhraseSheet.tsx) with search + category chips; tap = send as Text→Sign, ☆ = save to favorites.
14. **Logros y Medallas**: 12 achievements (`ACHIEVEMENTS` in server.py: first_lesson, streak_3/7/30, learned_10/50/100, lessons_10, perfect_lesson, review_clear, fav_5, messages_10) evaluated on `GET /learn/achievements` and after `learn/complete` / `review/complete` (returns `newly_unlocked`). Stored in `learning.achievements {id: iso_date}`. Learn tab grid of badges (locked 🔒), tap → detail modal; result screen shows "¡Nueva medalla!" panel.
15. **Compartir Logro**: unlocked badge modal renders a MedalCard (src/components/MedalCard.tsx: emoji, title, user, 🔥 streak, ✋ signs). "Compartir en WhatsApp" opens whatsapp://send?text (fallback wa.me) with a text card in one tap; native-only "Compartir imagen" captures the card with react-native-view-shot and opens the share sheet. New-badge rows on the result screen have a 📤 shortcut.
16. **Favoritos en Perfil**: Profile → "Gestionar frases favoritas" → `/favorites` screen (app/favorites.tsx): LSM/ASL filter, ▲▼ reorder (PUT /favorites/reorder {ids}), ✎ rename (PATCH /favorites/{id} {text}), 🗑 delete with inline confirm. Favorites now carry an `order` field; GET sorts by order.
17. **Recordatorio de Racha**: StreakBanner (src/components/StreakBanner.tsx) at top of translator when `learnProgress.completed_today` is false; shows streak to keep (or "start today"), CTA to Learn tab, ✕ dismisses for the current day (AsyncStorage).
18. **Practicar Frases**: ~60% of days (day-seeded RNG, `PHRASE_QUESTION_CHANCE`) one of the 5 daily slots is a full-phrase question: entry kind `phrase` (id `phrase-<i>`, label = phrase in user's language, description = the same phrase in the other language). Quiz asks "¿Cómo se dice esta frase?" with 4 phrase options. Phrase ids flow through learned_ids/weak_ids so Review Mode includes them (`_all_entries` = dictionary + `_phrase_entries`).
19. **Escuchar Frases**: phrase questions have a 🔊 "Escuchar" button (`quiz-listen`) that plays the foreign sentence via `POST /tts` (voice alloy for English / nova for Spanish) using expo-audio `createAudioPlayer`.

## Backend Endpoints (/api)
- `POST /auth/send-otp`, `POST /auth/verify-otp`, `GET /auth/me`, `POST /auth/onboard`, `PATCH /auth/profile`
- `GET /dictionary?language=&q=&letter=`, `GET /dictionary/{id}`
- `POST /translate/sign-frame {image_base64, language, previous[]}` → {sign|null, confidence}; `POST /translate/sign-to-text {language, signs[]}` (422 if empty), `POST /translate/text-to-sign` (text ≤500), `POST /translate/voice-to-text` (multipart, ≤10 MB, audio MIME only)
- `GET /messages`, `DELETE /messages`
- `POST /tts` (returns URL), `GET /tts/{key}.mp3`
- `POST /contacts/view {profileId?, displayName, profileImageUrl?, phone?}` → {contact, created, message}; `GET /contacts`; `DELETE /contacts/{id}`
- `GET /favorites?language=`, `POST /favorites {text, language}` (dedup), `DELETE /favorites/{id}`
- `GET /learn/today?language=` → {items:[{entry, options[4]}], progress}, `POST /learn/complete {language, correct_ids, wrong_ids, score, total}` → progress + counted, `GET /learn/progress`
- `GET /learn/review?language=` → {items (only weak_ids, ≤10), progress}, `POST /learn/review/complete {language, correct_ids, wrong_ids, score, total}` → progress + mastered (no streak change)

## Backlog
- Contacts integration to share translated messages (P1)
- Real SMS OTP provider, real CV sign recognition, 3D avatar (P2)

20. **UserContacts + Contacts Manager**: Mongo collection `UserContacts` {id, owner_user_id, profileId?, displayName, profileImageUrl?, phone?, lastSyncDate, isSavedLocally, createdAt} (indexes on owner+profileId, owner+lastSyncDate). Backend automation `contacts_manager_on_profile_view` runs on `POST /contacts/view` (called whenever a profile is accessed: ContactPicker selection or the Preview simulation): first access → insert with isSavedLocally=true and return message "Contacto sincronizado automáticamente" (created=true); later accesses → refresh lastSyncDate (created=false). `GET /contacts`, `DELETE /contacts/{id}`. UI: Profile → "Contactos sincronizados" (`/contacts`, app/contacts.tsx) with a PREVIEW panel that simulates viewing the "Andy" profile and shows the confirmation banner + list of synced contacts; ContactPicker shows the same banner when a recipient is opened.

## Security hardening (audit iteration)
- Strong random JWT_SECRET; `.env` files gitignored.
- verify-otp throttled: 5 failed attempts / 10 min per phone → 429 (in-memory).
- Upload limits (10 MB, audio MIME), Pydantic max_length on favorites (300), text-to-sign (500), tts (4000), sign-frame (~3 MB b64).
- Generic 502 messages for STT/TTS/vision failures (no exception text leaked).
- CORS: `CORS_ORIGINS` env (comma-separated) enables explicit origins + credentials; default `*` without credentials.
- OTP is now REAL via Twilio Verify (`TWILIO_ACCOUNT_SID/AUTH_TOKEN/VERIFY_SERVICE_SID` in backend/.env). Dev bypass: `OTP_DEV_BYPASS=true` + `OTP_TEST_NUMBERS` (E.164 list) accept `OTP_TEST_CODE` (123456) without SMS; if Twilio is not configured and bypass is on, all numbers are test numbers. send-otp returns `mode: test|sms` (no code leaked); otp screen shows the hint only for test numbers. Twilio errors mapped: invalid number 400, 21608 (unverified recipient / no compliance profile) 400, 60203/60202 429, 20404 expired 400, others 424 (non-5xx so JSON survives the CDN). LIVE VERIFIED 2026-09-15: SMS delivered to owner number +523171113788 (added as Verified Caller ID), code approved → JWT issued; code reuse → expired. Account is upgraded ($20) but Twilio requires an approved Primary Compliance Profile to text arbitrary numbers — until then only Verified Caller IDs receive SMS.

## Env
- `EMERGENT_LLM_KEY` for LLM/TTS/STT
- `JWT_SECRET` for auth tokens

## Design
Dark-first utility theme (surface #0D0E12, brand #FF5722). High contrast for accessibility.

## Roadmap agreed with user (2026-09-15)
- Phase 1 (DONE): camera isolation/focus lock/2.5 fps sampling + burst sequence recognition.
- Phase 2 (DONE 2026-09-16): Avatar gallery (male/female styles, persisted in user profile) + server-side MP4 composed from sign GIFs (ffmpeg) stored in object storage, validated >0 KB, played natively in the bubble (expo-video) with loading state.
- Phase 3 (DONE 2026-09-16): 1-to-1 chat between registered users (by phone) with 4 modes: Text/Voice→Sign(avatar video), Sign→Text/Voice(TTS), Sign→Sign(avatar video), Text/Voice→Text/Voice (voice-note STT + TTS).

## Phase 3 implementation notes (Chat 1:1)
- Collections: `conversations` {id, key(sorted ids), participants[], last_message{text,kind,sender_id,created_at}, last_read{user_id: dt}, updated_at}; `chat_messages` {id, conversation_id, sender_id, kind text|voice|sign, text, language, signs?, video_url?, avatar_id, created_at}.
- Endpoints: `POST /chat/match {phones[]}` (registered users among device contacts, last-10-digit match, excludes self); `POST /chat/conversations {peer_id|phone}` (idempotent, 404 unregistered, 400 self); `GET /chat/conversations` (peer, last_message, unread_count); `GET /chat/conversations/{cid}/messages?after=ISO` (polling; marks read; returns items, peer, me); `POST .../messages {kind text|sign, text?, signs[], language}` (sign → `_compose_sentence`); `POST .../voice` multipart (Whisper transcript → kind voice); `POST /chat/messages/{mid}/sign-video` (lazy avatar video with the SENDER's avatar, cached).
- UI: tab **Chats** (💬, `app/(tabs)/chats.tsx`, polls 4 s, unread badge) → `app/new-chat.tsx` (contacts permission flow → `chatMatch` → "En SignBridge" list; web/denied → manual number) → `app/chat/[id].tsx` (polls 2.5 s, composer: text / hold-🎤 voice note / 👐 `SignCaptureSheet`). Every bubble (`ChatBubble.tsx`) = text + 🔊 Escuchar (TTS) + 🤟 Ver en señas (inline `BubbleVideo`). Translator tab icon is now 🔄.

## Premium plan / Paywall (2026-09-16) — RevenueCat NOT connected yet (user skipped)
- Backend: `users.is_premium` (+ premium_plan, premium_since, premium_source, trial_ends_at). `FREE_AVATAR_IDS = {m1, f1}`; `GET /avatars` (optional auth) returns `locked` per avatar; `PATCH /auth/profile {avatar_id}` → 403 for locked avatars on free plan. `GET /billing/plans` (monthly `signbridge_premium_monthly` $79 MXN / $3.99 USD; yearly `signbridge_premium_yearly` $599 MXN / $29.99 USD, 7-day trial, best value), `GET /billing/status` (limits: free 15 s sign recording + ad every 10 messages; premium 60 s, no ads, all avatars). Dev-only (`PREMIUM_DEV_MODE=true` in backend/.env): `POST /billing/activate-test {plan}`, `POST /billing/deactivate-test`. Priority rendering: `build_sign_video(priority=is_premium)` — free renders share a 1-slot queue, premium bypasses it.
- Frontend: `src/premium.tsx` `PremiumProvider`/`usePremium()` (status cached in AsyncStorage, refreshed from `/billing/status`; `notifyMessageSent()` counts sent messages and shows the simulated `AdInterstitial` every 10 for free users). `app/paywall.tsx` (modal route; header + avatar preview with 🔒, 3-benefit checklist, plan selector with "Mejor valor"/"7 días gratis", CTA "Iniciar prueba gratis de 7 días" / "Suscribirme ahora" → store-only info modal; `EXPO_PUBLIC_PREMIUM_DEV_MODE=true` shows "🧪 Activar Premium sin pagar (prueba)"; footer Términos / Privacidad / Restaurar compras). Profile: Premium card (→ paywall). AvatarGallery: locked cards 🔒 → paywall?reason=avatar. Sign recording (translator + SignCaptureSheet): timer badge `Xs / 15s`, auto-stop at the plan limit, free users → paywall?reason=limit.
- TODO when RevenueCat is connected: replace `subscribe()` in paywall.tsx with `purchasePackage`, drive `is_premium` from the entitlement; replace `AdInterstitial` placeholder with AdMob interstitial (needs App ID + Ad Unit ID, native build only).

## Full-body 2D sign avatars (2026-09-16) — replaces isolated-hand GIF clips
- `backend/avatar2d.py`: Pillow renderer of a stylised waist-to-head character (head, torso, two IK-articulated arms, both hands). 6 looks (`LOOKS` m1-m3/f1-f3: skin/hair/shirt/hair style) matching `AVATARS`. Fingerspelled letters: dominant hand rises beside the shoulder and shows the dictionary handshape picture as a circular sticker; common words (`WORD_GESTURES`, es+en: hola, gracias, sí, no, por favor, amor, ayuda, agua, comer, casa, amigo, familia, perdón, bien, mamá, papá…) use bimanual keyframe gestures; unknown words are fingerspelled. Caption of the current sign at the bottom. Intro/outro breathing + return-to-rest.
- `server.build_sign_video(text, language, avatar_id, priority)` now takes the TEXT: `_tokenize_for_signs` → `avatar2d.render_frames` → ffmpeg image sequence → one continuous MP4 (+WebM twin), cache key prefixed `v2`. Used by `text-to-sign`, `voice-to-text` (now also returns `video_url`) and chat `sign-video`.
- Portraits: `GET /api/media/avatars/{id}.png` (rendered waving pose, cached); `GET /avatars` returns relative `image_url` → frontend `mediaUrl()` helper (api.ts) prefixes the backend URL.
- Translator top panel ("→ Señas" mode) shows the latest full-body video (`avatar-video`, BubbleVideo with `style` prop) instead of letter GIFs; "▶ Toca para ver la seña" replays a bubble's video there.

- Gesture library `backend/gestures.py` (2026-09-16): ~245 keys (all 38 dictionary words es+en, phrase vocabulary, numbers, question words, pronouns; multi-word keys like "por favor", "thank you", "te quiero", "sign language") built from primitives (R, BOTH, MIRROR, TAP, CIRCLE, SHAKE). `_tokenize_for_signs` does greedy longest-match (≤3 words, accent-insensitive via `gestures.normalize`), drops `STOPWORDS` (articles/prepositions/copulas), fingerspells only unknown words (names, unknown numbers). Camera recognition (`_sign_system_prompt`) lists the same vocabulary (`_sign_vocabulary(language)`) so the vision model returns whole words/phrases (rule: still hand → letter; movement/location/two hands → word). `_compose_sentence` already handles multi-word signs. Burst tests 10/10 green.

## Sign speed (2026-09-16)
- `src/signSpeed.ts`: global persisted speed (`slow` 0.5× / `normal` 1× / `fast` 1.5×, AsyncStorage `signbridge_sign_speed`) with `useSignSpeed()` hook (module store + listeners → every mounted video updates at once). `BubbleVideo` sets `player.playbackRate` and shows a tappable chip (bottom-left, `bubble-video-speed`) cycling the speed; Profile has a "⏱ Velocidad de las señas" selector (`profile-speed-{slow|normal|fast}`).

## Camera dual + video recording + real interpreter clips (2026-09-18)
- `src/useSignRecorder.ts` (shared by Translator and chat `SignCaptureSheet`): front/back `facing` toggle, `start/stop` with plan time limit, native = `CameraView mode="video"` + `recordAsync` → upload → `POST /translate/sign-video` (ffmpeg samples 2 fps, ≤16 frames, ONE vision call that segments the sequence) → `pending` review chips (`SignReviewBar`: trim → "✓ Traducir" / "➤ Enviar señas"); web = photo-burst live detection fallback. `CameraOverlay.tsx` renders switch button (`*-switch`), REC timer (`*-timer`), live box / chips, "Analizando señas cuidadosamente..." (`*-analyzing`). `SignCamera` accepts `facing`/`mode`.
- Backend `POST /translate/sign-video` (multipart video, language, save) → `{signs, text, frames_analyzed, message}`; 415/413/400 validation.
- Real interpreter clips: `backend/clips.py` maps ~70 normalized EN keys → Lifeprint GIFs (Bill Vicars, torso, both hands; credited). Pipeline = per-sign SEGMENTS (`media/segments/clip-<sha>.mp4` from real clip, or `av-<sha>.mp4` 2D avatar fallback rendered with `render_frames(intro=False)`), identical encoding (480x480, 15 fps, H.264 **Baseline** for Android, yuv420p) → ffmpeg concat `-c copy` → message MP4 + WebM twin (cache key `v3`). LSM/Spanish has no open clip source → 2D fallback for now.
- `GET /avatars` adds `interpreters` (thumbnail `GET /media/interpreters/{id}.png` from the real clip); Profile gallery shows an "🎥 Intérprete real" card + `onError` initials fallback for avatar images.
- Android black-box report: mitigated with Baseline profile + faststart; Range/Content-Length already served. Needs user re-test on Expo Go Android (native recording also only testable on device).

- **LSM clips (2026-09-18)**: `backend/fetch_lsm_clips.py` builds `clips_es.json` from **Spread the Sign es.mx** (European Sign Language Centre; direct `media.spreadthesign.com/video/mp4/...` URLs; exact slug matches only, incl. `10-diez` numeric slugs). 55 clips + Spanish aliases = 63 LSM keys (hola, gracias, no, amor, amigo, familia, mamá, papá, casa, comer, beber, agua, ayuda, baño, dinero, entender, aprender, teléfono, cansado, despacio, escuela, hoy, mañana, ayer, bien, mal, feliz, triste, cómo, hambre, dar, sordo, escribir, momento, hora, minuto, gente, pequeño, grande, números 1-10, esperar, mucho, comida, estudiar, lugar, ahora, bueno, malo, cuidar, hablar…). Words without an LSM video on Spread the Sign (sí, por favor, perdón, doctor, tiempo, nombre, trabajo, buenos días, buenas noches, adiós, dónde, necesitar, poder, cuánto, costar, repetir, lengua de señas, paciencia, te quiero, mucho gusto, hasta luego, ver, saber, qué, quién, cuándo, yo, tú…) still use the 2D avatar. `_clip_segment` handles mp4 sources (`-ignore_loop` only for GIF). Second interpreter card `spreadthesign-lsm` in `/avatars.interpreters`. License note: both sources are educational/non-commercial dictionaries — credits are returned in the API (`credit`) and shown in the Profile card.

## Session handling & chat badge (2026-09-16)
- `src/api.ts`: any authenticated request that returns 401 clears the token and `router.replace('/phone?expired=1')` (only adds `expired` when a token existed; debounced 3 s). `phone.tsx` shows "Tu sesión expiró…" notice (`session-expired`). `index.tsx` skips its own redirect when the error is `SESSION_EXPIRED_MESSAGE`.
- `GET /chat/unread` → `{unread}` total across conversations; `(tabs)/_layout.tsx` polls it every 5 s and shows `tabBarBadge` on the Chats tab (99+ cap).

## Phase 2 implementation notes
- Avatars: static catalog `AVATARS` (m1-m3 male, f1-f3 female; DiceBear PNG images). `GET /avatars?gender=`; `PATCH /auth/profile {avatar_id}` (400 unknown). Profile screen: AvatarGallery (filters Todo/Masculino/Femenino, persisted).
- Sign video: `build_sign_video()` composes intro card (avatar) + 1.2 s clip per letter GIF (dictionary letters, lifeprint `/fingerspelling/abc-gifs/` — old `/gifs-animated/` URLs 404 and were re-seeded) with ffmpeg (imageio-ffmpeg binary) → H.264 MP4 + VP8 WebM twin, cached in backend/media/videos/<sha>.{mp4,webm} (validated >0 KB). `text-to-sign` returns `video_url` + `avatar_id` (424 if render fails). `GET /api/media/videos/<name>` supports byte ranges (206).
- Frontend: BubbleVideo (expo-video, native player inside bubble, muted loop autoplay, ▶/⏸; web uses .webm because headless/open Chromium lacks H.264). "Generando video del avatar..." loading box while sending. Detected sign chips are tappable to remove (Corregir Secuencia).
- Phase 3 (chat 1:1, 4 modes) DONE — see notes above.
