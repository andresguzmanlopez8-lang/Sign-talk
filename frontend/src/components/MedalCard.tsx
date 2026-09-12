import { forwardRef } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, spacing, radius } from "@/src/theme";

export type BadgeInfo = { id: string; emoji: string; title: string; description: string; unlocked: boolean; unlocked_at?: string | null };

type Props = {
  badge: BadgeInfo;
  streak: number;
  learned: number;
  userName?: string | null;
  labels: { streak: string; signs: string; days: string };
};

/** Shareable medal card. Wrapped in forwardRef so it can be captured with react-native-view-shot. */
export const MedalCard = forwardRef<View, Props>(function MedalCard({ badge, streak, learned, userName, labels }, ref) {
  return (
    <View ref={ref} collapsable={false} style={styles.wrap} testID="medal-card">
      <LinearGradient colors={[colors.brandSecondary, colors.brandTertiary]} style={styles.card}>
        <Text style={styles.brand}>SignBridge</Text>
        <Text style={styles.emoji}>{badge.emoji}</Text>
        <Text style={styles.title}>{badge.title}</Text>
        {userName ? <Text style={styles.user}>{userName}</Text> : null}
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>🔥 {streak}</Text>
            <Text style={styles.statLabel}>{labels.streak} · {labels.days}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>✋ {learned}</Text>
            <Text style={styles.statLabel}>{labels.signs}</Text>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
});

export function ShareButtons({
  onWhatsApp,
  onImage,
  busy,
  labels,
}: {
  onWhatsApp: () => void;
  onImage?: () => void;
  busy: boolean;
  labels: { whatsapp: string; image: string };
}) {
  return (
    <View style={styles.shareRow}>
      <Pressable style={[styles.shareBtn, styles.whatsapp]} onPress={onWhatsApp} disabled={busy} testID="share-badge-whatsapp">
        <Text style={styles.shareText}>💬 {labels.whatsapp}</Text>
      </Pressable>
      {onImage && (
        <Pressable style={[styles.shareBtn, styles.imageBtn]} onPress={onImage} disabled={busy} testID="share-badge-image">
          {busy ? <ActivityIndicator color={colors.onSurface} /> : <Text style={styles.shareText}>📷 {labels.image}</Text>}
        </Pressable>
      )}
    </View>
  );
}

export function buildBadgeShareText(badge: BadgeInfo, streak: number, learned: number, labels: { intro: string; streak: string; signs: string; days: string }) {
  return `🏅 ${labels.intro}\n${badge.emoji} ${badge.title}\n🔥 ${labels.streak}: ${streak} ${labels.days} · ✋ ${labels.signs}: ${learned}\n#SignBridge`;
}

const styles = StyleSheet.create({
  wrap: { width: "100%", borderRadius: radius.lg, overflow: "hidden" },
  card: { padding: spacing.xl, alignItems: "center", gap: spacing.xs, borderRadius: radius.lg },
  brand: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase", opacity: 0.85 },
  emoji: { fontSize: 72, marginVertical: spacing.sm },
  title: { color: colors.onBrandPrimary, fontSize: 22, fontWeight: "800", textAlign: "center" },
  user: { color: colors.onBrandPrimary, fontSize: 13, opacity: 0.85 },
  stats: { flexDirection: "row", alignItems: "center", marginTop: spacing.md, backgroundColor: "rgba(0,0,0,0.25)", borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: spacing.md },
  stat: { alignItems: "center", minWidth: 90 },
  statValue: { color: colors.onBrandPrimary, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.onBrandPrimary, fontSize: 10, opacity: 0.8, textTransform: "uppercase", letterSpacing: 1 },
  divider: { width: 1, height: 32, backgroundColor: "rgba(255,255,255,0.3)" },
  shareRow: { flexDirection: "row", gap: spacing.sm, width: "100%" },
  shareBtn: { flex: 1, minHeight: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  whatsapp: { backgroundColor: "#25D366" },
  imageBtn: { backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  shareText: { color: colors.onSurface, fontWeight: "800", fontSize: 13 },
});
