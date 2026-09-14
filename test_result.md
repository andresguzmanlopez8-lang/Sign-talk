#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## Iteration 2 — New features (main agent)
- Favorites: GET/POST/DELETE /api/favorites; translator ⭐ on bubbles, favorites chip row above composer (tap=send Text→Sign, long-press=delete).
- Learning mode: GET /api/learn/today, POST /api/learn/complete (streak counted once/day), GET /api/learn/progress; new tab "Aprender" (app/(tabs)/learn.tsx) with 5-question quiz.
- PDF export: 📄 button in translator header (src/exportChat.ts, expo-print). Web opens print dialog; native uses share sheet.
- Credentials: any phone, OTP 123456. Login testIDs: phone-input, otp-0..otp-5; onboarding name placeholder "María López".

## Iteration 3 — main agent
- Contacts sharing: 📤 button (share-<msgId>) on bubbles → ContactPicker (testIDs: contact-picker, contacts-perm, request-contacts, open-settings, contact-search, contact-<id>, manual-phone, manual-continue, send-options, send-whatsapp, send-sms, change-contact, contact-picker-close). Web = manual number only (expo-contacts unsupported).
- Word emoji illustrations: dictionary entries kind=word now include `emoji`; rendered in dictionary cards (emoji-<id>), detail modal, quiz (quiz-emoji). Dictionary now 129 entries (38 words/lang).
- Seed changed to bulk upsert ($set by id) on startup.

## Iteration 4 — main agent
- Review mode: learn/complete now accepts wrong_ids → stored in weak_ids. GET /api/learn/review?language= (quiz from weak ids only), POST /api/learn/review/complete (correct → removed from weak, wrong → stays; streak untouched, counted=false, mastered=n).
- Learn tab: review-card, weak-count badge, start-review (disabled when 0 weak), quiz-counter prefixed "Modo Repaso", result shows review-stats (mastered / still weak); daily result shows review-hint when there were wrong answers.

## Iteration 5 — main agent
- Phrases: GET /api/phrases?language= (public, 20 items, 4 categories). Translator chip open-phrases → phrase-sheet (phrase-search, phrase-cat-all / phrase-cat-<id>, phrase-<id> tap=send, phrase-fav-<id> star, phrase-sheet-close).
- Achievements: GET /api/learn/achievements?language= → {items[12], unlocked_count, total}; learn/complete & review/complete now return newly_unlocked[]; progress has achievements_count. Learn tab: achievements-card, achievements-count, badge-<id> → badge-modal; result screen new-badges panel.

## Iteration 6 — main agent
- Favorites manager: PATCH /api/favorites/{id} {text}, PUT /api/favorites/reorder {ids}; GET sorted by `order`. Screen /favorites (from profile settings-favorites): fav-filter-es/en, fav-count, fav-row-<id>, fav-up/fav-down-<id>, fav-rename-<id> → rename-modal (rename-input, rename-save, rename-cancel), fav-delete-<id> → fav-confirm-<id> (fav-confirm-yes/no-<id>), favorites-back.
- Share badge: badge-modal for unlocked badge shows medal-card + share-badge-whatsapp (whatsapp://send?text fallback wa.me) + share-badge-image (native only). Result screen new badges have share-new-<id>.
- Streak banner: streak-banner in translator when lesson pending (streak-banner-text, streak-banner-go → learn tab, streak-banner-dismiss stores today's date in AsyncStorage).

## Iteration 7 — main agent
- Phrase questions in quiz: GET /api/learn/today may include (≈60% of user/day seeds) one item with entry.kind=="phrase" (id phrase-<i>, label in user's language, description = translation in other language, emoji = category emoji, 4 phrase options). Review includes weak phrase ids. Frontend: quiz-phrase block (foreign phrase in quotes), title "¿Cómo se dice esta frase?".

## Iteration 8 — main agent
- Listen button on phrase questions: quiz-listen → POST /api/tts (alloy when UI=es, nova when UI=en) → plays mp3 via expo-audio. Verified in browser: both /api/tts and /api/tts/<key>.mp3 return 200, no console errors.

## Iteration 9 — main agent
- REAL sign recognition: POST /api/translate/sign-frame {image_base64 (jpeg/png b64, data-URL prefix tolerated), language, previous[]} → {sign, confidence} via gpt-5.4 vision. Verified with ASL B/L/Y photos → B 0.94, L 0.99, Y 0.98 (~1.2s each). POST /api/translate/sign-to-text now takes {signs[]}; 422 when empty; composes letters into words ("H","I","hello" → "Hi hello"). Mock phrases + hint removed.
- Frontend translator: record-sign-btn is now a toggle (tap start / tap stop); live-sign overlay (live-sign-value, detected-sequence chips) while recording; toast noSignDetected when nothing detected. Camera capture can't run in headless web — test backend + UI render only.
- Security hardening: strong JWT_SECRET, .env gitignored, verify-otp throttle (429 after 5 failures/10min per phone), audio upload ≤10MB + MIME check (413/415), text length limits (422), generic 502 errors, CORS default without credentials.
- Image testing rules: /app/image_testing.md

## Iteration 10 — main agent
- UserContacts collection + Contacts Manager: POST /api/contacts/view (first access → created:true, message "Contacto sincronizado automáticamente", isSavedLocally true; repeat → created:false, lastSyncDate refreshed), GET /api/contacts (owner-scoped), DELETE /api/contacts/{id}.
- UI: Profile → settings-contacts → /contacts screen: preview-panel, simulate-profile-view (Andy), sync-confirmation banner, contact-row-<id>/contact-name-<id>/contact-delete-<id>, contacts-back. ContactPicker: selecting a contact/manual number calls contacts/view and shows contact-sync-banner in send-options.
