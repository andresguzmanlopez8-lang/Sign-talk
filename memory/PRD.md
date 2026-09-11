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
   - Sign→Text mode: Front camera view + big record button. Uses GPT to simulate sign recognition. TTS plays translated audio.
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

## Backend Endpoints (/api)
- `POST /auth/send-otp`, `POST /auth/verify-otp`, `GET /auth/me`, `POST /auth/onboard`, `PATCH /auth/profile`
- `GET /dictionary?language=&q=&letter=`, `GET /dictionary/{id}`
- `POST /translate/sign-to-text`, `POST /translate/text-to-sign`, `POST /translate/voice-to-text` (multipart)
- `GET /messages`, `DELETE /messages`
- `POST /tts` (returns URL), `GET /tts/{key}.mp3`
- `GET /favorites?language=`, `POST /favorites {text, language}` (dedup), `DELETE /favorites/{id}`
- `GET /learn/today?language=` → {items:[{entry, options[4]}], progress}, `POST /learn/complete {language, correct_ids, wrong_ids, score, total}` → progress + counted, `GET /learn/progress`
- `GET /learn/review?language=` → {items (only weak_ids, ≤10), progress}, `POST /learn/review/complete {language, correct_ids, wrong_ids, score, total}` → progress + mastered (no streak change)

## Backlog
- Contacts integration to share translated messages (P1)
- Real SMS OTP provider, real CV sign recognition, 3D avatar (P2)

## Env
- `EMERGENT_LLM_KEY` for LLM/TTS/STT
- `JWT_SECRET` for auth tokens

## Design
Dark-first utility theme (surface #0D0E12, brand #FF5722). High contrast for accessibility.
