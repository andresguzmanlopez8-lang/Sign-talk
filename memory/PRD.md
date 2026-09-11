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

## Backend Endpoints (/api)
- `POST /auth/send-otp`, `POST /auth/verify-otp`, `GET /auth/me`, `POST /auth/onboard`, `PATCH /auth/profile`
- `GET /dictionary?language=&q=&letter=`, `GET /dictionary/{id}`
- `POST /translate/sign-to-text`, `POST /translate/text-to-sign`, `POST /translate/voice-to-text` (multipart)
- `GET /messages`, `DELETE /messages`
- `POST /tts` (returns URL), `GET /tts/{key}.mp3`
- `GET /favorites?language=`, `POST /favorites {text, language}` (dedup), `DELETE /favorites/{id}`
- `GET /learn/today?language=` → {items:[{entry, options[4]}], progress}, `POST /learn/complete {language, correct_ids, score, total}` → progress + counted, `GET /learn/progress`

## Backlog
- Contacts integration to share translated messages (P1)
- Real SMS OTP provider, real CV sign recognition, 3D avatar (P2)

## Env
- `EMERGENT_LLM_KEY` for LLM/TTS/STT
- `JWT_SECRET` for auth tokens

## Design
Dark-first utility theme (surface #0D0E12, brand #FF5722). High contrast for accessibility.
