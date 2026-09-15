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
   - Sign→Text mode (REAL recognition): tap 🎥 to start; every 1.5 s a downscaled frame (512px JPEG, expo-image-manipulator on native / base64 on web) is sent to `POST /translate/sign-frame` → OpenAI gpt-5.4 vision (emergentintegrations LlmChat + ImageContent) returns `{sign, confidence}`. Live overlay shows the detected sign + confidence and the running sequence (chips). Tap ⏹ to stop → `POST /translate/sign-to-text {signs}` composes the sentence deterministically (consecutive letters spell a word) and saves it; TTS plays it. No signs → toast 'No se detectó ninguna seña' and nothing is saved. All mock phrases removed.
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
