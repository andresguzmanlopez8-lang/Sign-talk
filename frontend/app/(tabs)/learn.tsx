import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, RefreshControl, Modal, Linking, Platform } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { captureRef } from "react-native-view-shot";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { MedalCard, ShareButtons, buildBadgeShareText } from "@/src/components/MedalCard";

type Entry = { id: string; label: string; kind: string; description: string; emoji?: string | null; gif_url?: string | null; image_url?: string | null };
type Item = { entry: Entry; options: string[] };
type Progress = {
  streak: number;
  best_streak: number;
  completed_today: boolean;
  learned_count: number;
  lessons_completed: number;
  weak_count: number;
};
type Achievement = { id: string; emoji: string; title: string; description: string; unlocked: boolean; unlocked_at?: string | null };

type Phase = "home" | "quiz" | "result";
type QuizKind = "daily" | "review";

export default function Learn() {
  const insets = useSafeAreaInsets();
  const { t, lang } = useLang();
  const [items, setItems] = useState<Item[]>([]);
  const [dailyItems, setDailyItems] = useState<Item[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [selectedBadge, setSelectedBadge] = useState<Achievement | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("home");
  const [quizKind, setQuizKind] = useState<QuizKind>("daily");
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correctIds, setCorrectIds] = useState<string[]>([]);
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [result, setResult] = useState<any | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const cardRef = useRef<View>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => () => playerRef.current?.remove?.(), []);

  /** Pronounce the foreign-language sentence of a phrase question via backend TTS. */
  const speakPhrase = async (text: string) => {
    if (speaking) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSpeaking(true);
    try {
      // The sentence shown is in the *other* language: es UI → English voice, en UI → Spanish voice.
      const voice = lang === "es" ? "alloy" : "nova";
      const tts = await api.tts(text, voice);
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      playerRef.current?.remove?.();
      const player = createAudioPlayer({ uri: `${api.base}${tts.url}` });
      playerRef.current = player;
      player.play();
    } catch (e) {
      console.warn("tts", e);
    } finally {
      setSpeaking(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, ach] = await Promise.all([api.learnToday(lang), api.achievements(lang)]);
      setDailyItems(res.items);
      setProgress(res.progress);
      setAchievements(ach.items);
      api.me().then((u) => setUserName(u?.name ?? null)).catch(() => {});
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [lang]);

  const shareLabels = { intro: t.shareBadgeText, streak: t.streakLabel, signs: t.signsMastered, days: t.days };

  const shareBadgeWhatsApp = async (badge: Achievement) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const text = encodeURIComponent(buildBadgeShareText(badge, progress?.streak ?? 0, progress?.learned_count ?? 0, shareLabels));
    const native = `whatsapp://send?text=${text}`;
    const web = `https://wa.me/?text=${text}`;
    try {
      if (Platform.OS !== "web" && (await Linking.canOpenURL(native))) await Linking.openURL(native);
      else await Linking.openURL(web);
    } catch (e) {
      console.warn("share wa", e);
    }
  };

  const shareBadgeImage = async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, { format: "png", quality: 1 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: t.achievements });
    } catch (e) {
      console.warn("share img", e);
    } finally {
      setSharing(false);
    }
  };

  useEffect(() => {
    setPhase("home");
    load();
  }, [load]);

  const beginQuiz = (kind: QuizKind, quizItems: Item[]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setQuizKind(kind);
    setItems(quizItems);
    setIdx(0);
    setPicked(null);
    setCorrectIds([]);
    setWrongIds([]);
    setResult(null);
    setPhase("quiz");
  };

  const startQuiz = () => beginQuiz("daily", dailyItems);

  const startReview = async () => {
    setLoadingReview(true);
    try {
      const res = await api.learnReview(lang);
      if (res.items.length > 0) beginQuiz("review", res.items);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoadingReview(false);
    }
  };

  const current = items[idx];
  const isCorrect = picked !== null && current && picked === current.entry.label;

  const choose = (opt: string) => {
    if (picked !== null) return;
    setPicked(opt);
    if (opt === current.entry.label) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCorrectIds((prev) => [...prev, current.entry.id]);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setWrongIds((prev) => [...prev, current.entry.id]);
    }
  };

  const next = async () => {
    if (idx + 1 < items.length) {
      setIdx(idx + 1);
      setPicked(null);
      return;
    }
    setSubmitting(true);
    try {
      const payload = { language: lang, correct_ids: correctIds, wrong_ids: wrongIds, score: correctIds.length, total: items.length };
      const res = quizKind === "review" ? await api.learnReviewComplete(payload) : await api.learnComplete(payload);
      setResult(res);
      setProgress(res);
      if (res.newly_unlocked?.length) {
        setAchievements((prev) =>
          prev.map((a) => {
            const n = res.newly_unlocked.find((x: Achievement) => x.id === a.id);
            return n ? { ...a, ...n } : a;
          })
        );
      }
      setPhase("result");
    } catch (e) {
      console.warn(e);
    } finally {
      setSubmitting(false);
    }
  };

  const renderHome = () => (
    <ScrollView
      contentContainerStyle={styles.homeContent}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
    >
      <View style={styles.streakCard} testID="streak-card">
        <Text style={styles.streakFire}>🔥</Text>
        <Text style={styles.streakNum} testID="streak-count">{progress?.streak ?? 0}</Text>
        <Text style={styles.streakLabel}>{t.streak} · {t.days}</Text>
      </View>

      <View style={styles.statsRow}>
        <Stat label={t.bestStreak} value={progress?.best_streak ?? 0} testID="stat-best" />
        <Stat label={t.learned} value={progress?.learned_count ?? 0} testID="stat-learned" />
        <Stat label={t.lessons} value={progress?.lessons_completed ?? 0} testID="stat-lessons" />
      </View>

      <View style={styles.lessonCard}>
        <Text style={styles.lessonTitle}>🎓 {t.dailyLesson}</Text>
        <Text style={styles.lessonDesc}>{progress?.completed_today ? t.lessonDone : t.lessonDesc}</Text>
        {progress?.completed_today && <Text style={styles.lessonHint}>{t.comeBackTomorrow}</Text>}
        <View style={styles.previewRow}>
          {dailyItems.map((it) => (
            <View key={it.entry.id} style={styles.previewChip}>
              <Text style={styles.previewText}>{it.entry.label}</Text>
            </View>
          ))}
        </View>
        <Pressable
          style={[styles.primaryBtn, dailyItems.length === 0 && styles.btnDisabled]}
          onPress={startQuiz}
          disabled={dailyItems.length === 0}
          testID="start-lesson"
        >
          <Text style={styles.primaryBtnText}>{progress?.completed_today ? t.practiceAgain : t.startLesson}</Text>
        </Pressable>
      </View>

      <View style={styles.lessonCard} testID="review-card">
        <View style={styles.reviewHeader}>
          <Text style={styles.lessonTitle}>🎯 {t.reviewMode}</Text>
          {(progress?.weak_count ?? 0) > 0 && (
            <View style={styles.weakBadge} testID="weak-count">
              <Text style={styles.weakBadgeText}>{progress?.weak_count}</Text>
            </View>
          )}
        </View>
        <Text style={styles.lessonDesc}>
          {(progress?.weak_count ?? 0) > 0 ? `${t.reviewDesc} ${progress?.weak_count} ${t.weakSigns}.` : t.reviewEmpty}
        </Text>
        <Pressable
          style={[styles.secondaryBtn, (progress?.weak_count ?? 0) === 0 && styles.btnDisabled]}
          onPress={startReview}
          disabled={(progress?.weak_count ?? 0) === 0 || loadingReview}
          testID="start-review"
        >
          {loadingReview ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : (
            <Text style={styles.secondaryBtnText}>{t.startReview}</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.lessonCard} testID="achievements-card">
        <View style={styles.reviewHeader}>
          <Text style={styles.lessonTitle}>🏅 {t.achievements}</Text>
          <Text style={styles.achCount} testID="achievements-count">
            {achievements.filter((a) => a.unlocked).length} / {achievements.length}
          </Text>
        </View>
        <View style={styles.badgeGrid}>
          {achievements.map((a) => (
            <Pressable
              key={a.id}
              style={[styles.badge, !a.unlocked && styles.badgeLocked]}
              onPress={() => setSelectedBadge(a)}
              testID={`badge-${a.id}`}
              accessibilityLabel={a.title}
            >
              <Text style={styles.badgeEmoji}>{a.unlocked ? a.emoji : "🔒"}</Text>
              <Text style={styles.badgeTitle} numberOfLines={2}>{a.title}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );

  const renderQuiz = () => (
    <ScrollView contentContainerStyle={styles.quizContent}>
      <View style={styles.progressBar}>
        {items.map((_, i) => (
          <View key={i} style={[styles.progressSeg, i <= idx && styles.progressSegActive]} />
        ))}
      </View>
      <Text style={styles.qCounter} testID="quiz-counter">
        {quizKind === "review" ? `🎯 ${t.reviewMode} · ` : ""}{t.question} {idx + 1} / {items.length}
      </Text>

      <View style={styles.qImage}>
        {current.entry.kind === "phrase" ? (
          <View style={[styles.emojiBox, styles.phraseBox]} testID="quiz-phrase">
            <Text style={styles.phraseTag}>🗣️ {t.phraseQuestion}</Text>
            <Text style={styles.phraseForeign}>“{current.entry.description}”</Text>
            <Pressable
              style={[styles.listenBtn, speaking && styles.btnDisabled]}
              onPress={() => speakPhrase(current.entry.description)}
              disabled={speaking}
              testID="quiz-listen"
              accessibilityLabel={t.listen}
            >
              {speaking ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.listenText}>🔊 {t.listen}</Text>}
            </Pressable>
          </View>
        ) : current.entry.emoji ? (
          <View style={styles.emojiBox} testID="quiz-emoji">
            <Text style={styles.emojiBig}>{current.entry.emoji}</Text>
          </View>
        ) : (
          <Image
            source={{ uri: current.entry.gif_url || current.entry.image_url || "" }}
            style={{ width: "100%", height: "100%" }}
            contentFit="contain"
          />
        )}
      </View>
      <Text style={styles.qTitle}>{current.entry.kind === "phrase" ? t.translatePhrase : t.whichSign}</Text>
      {current.entry.kind !== "phrase" && <Text style={styles.qDesc}>{current.entry.description}</Text>}

      <View style={styles.options}>
        {current.options.map((opt) => {
          const chosen = picked === opt;
          const right = picked !== null && opt === current.entry.label;
          const wrong = chosen && !right;
          return (
            <Pressable
              key={opt}
              style={[styles.option, right && styles.optionRight, wrong && styles.optionWrong]}
              onPress={() => choose(opt)}
              disabled={picked !== null}
              testID={`option-${opt}`}
            >
              <Text style={[styles.optionText, (right || wrong) && styles.optionTextOn]}>{opt}</Text>
            </Pressable>
          );
        })}
      </View>

      {picked !== null && (
        <View style={styles.feedback}>
          <Text style={[styles.feedbackText, { color: isCorrect ? colors.success : colors.error }]} testID="quiz-feedback">
            {isCorrect ? `✅ ${t.correct}` : `❌ ${t.incorrect} ${current.entry.label}`}
          </Text>
          <Pressable style={styles.primaryBtn} onPress={next} disabled={submitting} testID="quiz-next">
            {submitting ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.primaryBtnText}>{idx + 1 < items.length ? t.next : t.seeResults}</Text>
            )}
          </Pressable>
        </View>
      )}
    </ScrollView>
  );

  const renderResult = () => (
    <View style={styles.resultWrap} testID="quiz-result">
      <Text style={styles.resultEmoji}>{correctIds.length === items.length ? "🏆" : correctIds.length >= 3 ? "🎉" : "💪"}</Text>
      <Text style={styles.resultLabel}>{t.yourScore}</Text>
      <Text style={styles.resultScore} testID="result-score">{correctIds.length} / {items.length}</Text>
      {result?.counted && (
        <View style={styles.streakBadge}>
          <Text style={styles.streakBadgeText}>🔥 {t.streakUp} {result.streak} {t.days}</Text>
        </View>
      )}
      {quizKind === "review" && (
        <View style={styles.reviewStats} testID="review-stats">
          <Text style={styles.reviewStat}>✅ {t.mastered}: {correctIds.length}</Text>
          <Text style={styles.reviewStat}>🎯 {t.stillWeak}: {result?.weak_count ?? wrongIds.length}</Text>
        </View>
      )}
      {quizKind === "daily" && wrongIds.length > 0 && (
        <Text style={styles.reviewHint} testID="review-hint">🎯 {wrongIds.length} {t.weakSigns}</Text>
      )}
      {result?.newly_unlocked?.length > 0 && (
        <View style={styles.newBadges} testID="new-badges">
          <Text style={styles.newBadgesTitle}>🎉 {t.newBadge}</Text>
          {result.newly_unlocked.map((a: Achievement) => (
            <View key={a.id} style={styles.newBadgeRow}>
              <Text style={styles.newBadgeEmoji}>{a.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.newBadgeName}>{a.title}</Text>
                <Text style={styles.newBadgeDesc}>{a.description}</Text>
              </View>
              <Pressable style={styles.miniShare} onPress={() => shareBadgeWhatsApp(a)} testID={`share-new-${a.id}`} accessibilityLabel={t.shareWhatsApp}>
                <Text style={styles.miniShareText}>📤</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <Pressable style={styles.primaryBtn} onPress={() => { setPhase("home"); load(); }} testID="quiz-finish">
        <Text style={styles.primaryBtnText}>{t.finish}</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title} testID="learn-title">{t.learn}</Text>
        <View style={styles.langPill}>
          <Text style={styles.langPillText}>{lang === "es" ? "🇲🇽 LSM" : "🇺🇸 ASL"}</Text>
        </View>
      </View>
      {loading && phase === "home" && !progress ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
      ) : phase === "home" ? (
        renderHome()
      ) : phase === "quiz" && current ? (
        renderQuiz()
      ) : (
        renderResult()
      )}

      <Modal visible={!!selectedBadge} transparent animationType="fade" onRequestClose={() => setSelectedBadge(null)}>
        <Pressable style={styles.badgeModalBg} onPress={() => setSelectedBadge(null)} testID="badge-modal-bg">
          {selectedBadge && (
            <Pressable style={styles.badgeModal} onPress={() => {}} testID="badge-modal">
              {selectedBadge.unlocked ? (
                <>
                  <MedalCard
                    ref={cardRef}
                    badge={selectedBadge}
                    streak={progress?.streak ?? 0}
                    learned={progress?.learned_count ?? 0}
                    userName={userName}
                    labels={{ streak: t.streakLabel, signs: t.signsMastered, days: t.days }}
                  />
                  <Text style={styles.badgeModalDesc}>{selectedBadge.description}</Text>
                  <Text style={[styles.badgeModalState, { color: colors.success }]}>
                    ✅ {t.unlockedOn} · {new Date(selectedBadge.unlocked_at!).toLocaleDateString(lang === "es" ? "es-MX" : "en-US")}
                  </Text>
                  <ShareButtons
                    onWhatsApp={() => shareBadgeWhatsApp(selectedBadge)}
                    onImage={Platform.OS !== "web" ? shareBadgeImage : undefined}
                    busy={sharing}
                    labels={{ whatsapp: t.shareWhatsApp, image: t.shareImage }}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.badgeModalEmoji}>🔒</Text>
                  <Text style={styles.badgeModalTitle}>{selectedBadge.title}</Text>
                  <Text style={styles.badgeModalDesc}>{selectedBadge.description}</Text>
                  <Text style={[styles.badgeModalState, { color: colors.muted }]}>🔒 {t.locked}</Text>
                </>
              )}
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

function Stat({ label, value, testID }: { label: string; value: number; testID: string }) {
  return (
    <View style={styles.stat} testID={testID}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  langPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  langPillText: { color: colors.onSurface, fontWeight: "700", fontSize: 12 },
  homeContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  streakCard: { alignItems: "center", backgroundColor: colors.brandTertiary, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.brandPrimary },
  streakFire: { fontSize: 48 },
  streakNum: { color: colors.onSurface, fontSize: 56, fontWeight: "800", lineHeight: 64 },
  streakLabel: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: 13, textTransform: "uppercase", letterSpacing: 1 },
  statsRow: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  statValue: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  statLabel: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2, textAlign: "center" },
  lessonCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  lessonTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  lessonDesc: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  lessonHint: { color: colors.onSurfaceTertiary, fontSize: 12 },
  previewRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  previewChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  previewText: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  primaryBtn: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.pill, alignItems: "center", minHeight: 48, justifyContent: "center" },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
  secondaryBtn: { borderWidth: 1, borderColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.pill, alignItems: "center", minHeight: 48, justifyContent: "center" },
  secondaryBtnText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 15 },
  reviewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  weakBadge: { backgroundColor: colors.warning, minWidth: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  weakBadgeText: { color: colors.onWarning, fontWeight: "800", fontSize: 13 },
  reviewStats: { gap: spacing.xs, alignItems: "center" },
  reviewStat: { color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: 14 },
  reviewHint: { color: colors.warning, fontWeight: "700", fontSize: 13 },
  achCount: { color: colors.brandPrimary, fontWeight: "800", fontSize: 14 },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: { width: "30%", flexGrow: 1, minWidth: 90, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.sm, alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.brandPrimary, minHeight: 84, justifyContent: "center" },
  badgeLocked: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border, opacity: 0.6 },
  badgeEmoji: { fontSize: 28 },
  badgeTitle: { color: colors.onSurface, fontSize: 11, fontWeight: "700", textAlign: "center" },
  newBadges: { width: "100%", backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.brandPrimary },
  newBadgesTitle: { color: colors.onBrandTertiary, fontWeight: "800", fontSize: 15, textAlign: "center" },
  newBadgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  newBadgeEmoji: { fontSize: 32 },
  newBadgeName: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  newBadgeDesc: { color: colors.onSurfaceSecondary, fontSize: 12 },
  badgeModalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  badgeModal: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, alignItems: "center", gap: spacing.sm, width: "100%", borderWidth: 1, borderColor: colors.border },
  badgeModalEmoji: { fontSize: 72 },
  badgeModalTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "800", textAlign: "center" },
  badgeModalDesc: { color: colors.onSurfaceSecondary, fontSize: 14, textAlign: "center" },
  badgeModalState: { fontWeight: "700", fontSize: 12, marginTop: spacing.sm },
  miniShare: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.25)", alignItems: "center", justifyContent: "center" },
  miniShareText: { fontSize: 18 },
  quizContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  progressBar: { flexDirection: "row", gap: 4 },
  progressSeg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary },
  progressSegActive: { backgroundColor: colors.brandPrimary },
  qCounter: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  qImage: { width: "100%", height: 200, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, overflow: "hidden" },
  emojiBox: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary },
  emojiBig: { fontSize: 110 },
  phraseBox: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surfaceTertiary },
  phraseTag: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  phraseForeign: { color: colors.onSurface, fontSize: 22, fontWeight: "800", textAlign: "center", lineHeight: 30 },
  phraseCatEmoji: { fontSize: 28 },
  listenBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, minHeight: 44, minWidth: 120, justifyContent: "center" },
  listenText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 14 },
  qTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  qDesc: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  options: { gap: spacing.sm },
  option: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border, minHeight: 48, justifyContent: "center" },
  optionRight: { backgroundColor: colors.success, borderColor: colors.success },
  optionWrong: { backgroundColor: colors.error, borderColor: colors.error },
  optionText: { color: colors.onSurface, fontWeight: "700", fontSize: 16 },
  optionTextOn: { color: colors.onSurface },
  feedback: { gap: spacing.md, marginTop: spacing.sm },
  feedbackText: { fontWeight: "800", fontSize: 15, textAlign: "center" },
  resultWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  resultEmoji: { fontSize: 72 },
  resultLabel: { color: colors.onSurfaceTertiary, fontSize: 13, textTransform: "uppercase", letterSpacing: 1 },
  resultScore: { color: colors.onSurface, fontSize: 48, fontWeight: "800" },
  streakBadge: { backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.brandPrimary },
  streakBadgeText: { color: colors.onBrandTertiary, fontWeight: "800" },
});
