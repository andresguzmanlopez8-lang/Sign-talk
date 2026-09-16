import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";

const SKIP_SECONDS = 5;

type Props = { visible: boolean; onClose: () => void };

/**
 * Simulated interstitial ad shown to free users every N messages.
 * Placeholder until AdMob (react-native-google-mobile-ads) is connected in the native build.
 */
export default function AdInterstitial({ visible, onClose }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLang();
  const [left, setLeft] = useState(SKIP_SECONDS);

  useEffect(() => {
    if (!visible) return;
    setLeft(SKIP_SECONDS);
    const iv = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(iv);
  }, [visible]);

  const goPremium = () => {
    onClose();
    router.push({ pathname: "/paywall", params: { reason: "ads" } });
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => left === 0 && onClose()}>
      <View style={[styles.bg, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]} testID="ad-interstitial">
        <View style={styles.topRow}>
          <Text style={styles.adTag}>{t.adTitle}</Text>
          {left > 0 ? (
            <Text style={styles.countdown} testID="ad-countdown">{t.adSkipIn} {left}s</Text>
          ) : (
            <Pressable onPress={onClose} style={styles.closeBtn} testID="ad-close" accessibilityLabel={t.adClose}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.card}>
          <Text style={styles.cardIcon}>📢</Text>
          <Text style={styles.cardTitle}>SignBridge</Text>
          <Text style={styles.cardText}>{t.adPlaceholder}</Text>
        </View>
        <Pressable style={styles.premiumBtn} onPress={goPremium} testID="ad-remove-ads">
          <Text style={styles.premiumText}>✨ {t.removeAds}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", paddingHorizontal: spacing.lg, justifyContent: "space-between" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  adTag: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  countdown: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "700" },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: colors.surfaceSecondary },
  closeText: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border, minHeight: 280, justifyContent: "center" },
  cardIcon: { fontSize: 56 },
  cardTitle: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  cardText: { color: colors.onSurfaceTertiary, fontSize: 14, textAlign: "center", lineHeight: 20 },
  premiumBtn: { backgroundColor: colors.brandPrimary, minHeight: 52, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  premiumText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 15 },
});
