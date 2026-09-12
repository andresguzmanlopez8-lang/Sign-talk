import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";

const DISMISS_KEY = "signbridge_streak_banner_dismissed";
const today = () => new Date().toISOString().slice(0, 10);

/** Shows a reminder when today's lesson is still pending. Dismissal lasts for the current day. */
export default function StreakBanner() {
  const router = useRouter();
  const { t } = useLang();
  const [streak, setStreak] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const dismissed = await AsyncStorage.getItem(DISMISS_KEY);
          if (dismissed === today()) return;
          const p = await api.learnProgress();
          if (!active) return;
          setStreak(p.streak ?? 0);
          setVisible(!p.completed_today);
        } catch {}
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  if (!visible || streak === null) return null;

  const dismiss = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVisible(false);
    await AsyncStorage.setItem(DISMISS_KEY, today());
  };

  return (
    <View style={styles.banner} testID="streak-banner">
      <Text style={styles.fire}>🔥</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{t.streakPending}</Text>
        <Text style={styles.sub} testID="streak-banner-text">
          {streak > 0 ? `${t.streakKeep} ${streak} ${t.days}` : t.streakStart}
        </Text>
      </View>
      <Pressable style={styles.cta} onPress={() => router.push("/(tabs)/learn")} testID="streak-banner-go">
        <Text style={styles.ctaText}>{t.goToLesson}</Text>
      </Pressable>
      <Pressable style={styles.close} onPress={dismiss} testID="streak-banner-dismiss" accessibilityLabel="Cerrar">
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.sm, paddingLeft: spacing.md, borderWidth: 1, borderColor: colors.brandPrimary },
  fire: { fontSize: 22 },
  title: { color: colors.onSurface, fontWeight: "800", fontSize: 13 },
  sub: { color: colors.onBrandTertiary, fontSize: 11, fontWeight: "600" },
  cta: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, minHeight: 36, justifyContent: "center" },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 11 },
  close: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  closeText: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: "700" },
});
