import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";

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

type Phase = "home" | "quiz" | "result";
type QuizKind = "daily" | "review";

export default function Learn() {
  const insets = useSafeAreaInsets();
  const { t, lang } = useLang();
  const [items, setItems] = useState<Item[]>([]);
  const [dailyItems, setDailyItems] = useState<Item[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.learnToday(lang);
      setDailyItems(res.items);
      setProgress(res.progress);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [lang]);

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
        {current.entry.emoji ? (
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
      <Text style={styles.qTitle}>{t.whichSign}</Text>
      <Text style={styles.qDesc}>{current.entry.description}</Text>

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
  quizContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  progressBar: { flexDirection: "row", gap: 4 },
  progressSeg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary },
  progressSegActive: { backgroundColor: colors.brandPrimary },
  qCounter: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  qImage: { width: "100%", height: 200, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, overflow: "hidden" },
  emojiBox: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary },
  emojiBig: { fontSize: 110 },
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
