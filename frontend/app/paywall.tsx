import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { usePremium } from "@/src/premium";

type Plan = { id: "monthly" | "yearly"; product_id: string; price_mxn: number; price_usd: number; trial_days: number; best_value: boolean };
type Avatar = { id: string; name: string; image_url: string; locked: boolean };
const DEV_MODE = process.env.EXPO_PUBLIC_PREMIUM_DEV_MODE === "true";

/** Paywall: Free vs Premium. Store purchases (RevenueCat) will plug into `subscribe()`; test mode activates Premium for QA. */
export default function Paywall() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, lang } = useLang();
  const { reason } = useLocalSearchParams<{ reason?: "limit" | "avatar" | "ads" }>();
  const { status, isPremium, setStatus, refresh } = usePremium();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [selected, setSelected] = useState<"monthly" | "yearly">("yearly");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [storeInfo, setStoreInfo] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    api.billingPlans().then((r) => setPlans(r.plans)).catch(() => {});
    api.avatars().then((r) => setAvatars(r.items)).catch(() => {});
    refresh();
  }, [refresh]);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  };

  const price = (p: Plan) => (lang === "es" ? `$${p.price_mxn} MXN` : `$${p.price_usd.toFixed(2)} USD`);
  const plan = plans.find((p) => p.id === selected);

  /** Store purchase entry point — RevenueCat `purchasePackage` will be wired here. */
  const subscribe = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStoreInfo(true);
  };

  const activateTest = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBusy(true);
    try {
      setStatus(await api.activatePremiumTest(selected));
      setStoreInfo(false);
      setSuccess(true);
    } catch (e: any) {
      showToast(e?.message ?? "Error");
    } finally {
      setBusy(false);
    }
  };

  const deactivateTest = async () => {
    setBusy(true);
    try {
      setStatus(await api.deactivatePremiumTest());
      showToast(t.freePlan);
    } catch (e: any) {
      showToast(e?.message ?? "Error");
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"));

  const reasonText = reason === "limit" ? t.limitReachedDesc : reason === "avatar" ? t.reasonAvatar : reason === "ads" ? t.reasonAds : null;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xl }]} testID="paywall-screen">
        <View style={styles.topBar}>
          <Pressable onPress={goBack} style={styles.close} testID="paywall-close">
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          {DEV_MODE && <Text style={styles.devTag}>{t.testMode}</Text>}
        </View>

        <LinearGradient colors={[colors.brandTertiary, colors.surface]} style={styles.hero}>
          <Text style={styles.crown}>👑</Text>
          <Text style={styles.title} testID="paywall-title">{isPremium ? t.premiumActive : t.premiumTitle}</Text>
          <Text style={styles.subtitle}>{isPremium ? t.premiumActiveDesc : t.premiumSubtitle}</Text>
          <View style={styles.avatarRow} testID="paywall-avatars">
            {avatars.map((a) => (
              <View key={a.id} style={styles.avatarWrap}>
                <Image source={{ uri: a.image_url }} style={styles.avatarImg} contentFit="cover" />
                {a.locked && (
                  <View style={styles.lockBadge}>
                    <Text style={styles.lockText}>🔒</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </LinearGradient>

        {toast && (
          <View style={styles.toast} testID="paywall-toast">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}

        {reasonText && !isPremium && (
          <View style={styles.reasonBox} testID="paywall-reason">
            <Text style={styles.reasonTitle}>{reason === "limit" ? `⏱ ${t.limitReached}` : "✨"}</Text>
            <Text style={styles.reasonText}>{reasonText}</Text>
          </View>
        )}

        <View style={styles.benefits}>
          {[t.benefitNoAds, t.benefitAvatars, t.benefitPriority].map((b) => (
            <View key={b} style={styles.benefitRow}>
              <View style={styles.checkCircle}>
                <Text style={styles.check}>✓</Text>
              </View>
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        {isPremium ? (
          <View style={styles.activeCard} testID="paywall-active">
            <Text style={styles.activeLabel}>{t.currentPlan}</Text>
            <Text style={styles.activePlan}>
              {status.plan === "yearly" ? t.planYearly : t.planMonthly} · {t.premium}
            </Text>
            {status.trial_ends_at && (
              <Text style={styles.activeMeta}>{t.freeTrial} → {new Date(status.trial_ends_at).toLocaleDateString()}</Text>
            )}
            {DEV_MODE && status.source === "test" && (
              <Pressable style={styles.ghostBtn} onPress={deactivateTest} disabled={busy} testID="paywall-deactivate-test">
                {busy ? <ActivityIndicator color={colors.onSurface} /> : <Text style={styles.ghostText}>{t.deactivateTest}</Text>}
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <View style={styles.plans} testID="paywall-plans">
              {plans.length === 0 ? (
                <ActivityIndicator color={colors.brandPrimary} />
              ) : (
                plans.map((p) => {
                  const active = p.id === selected;
                  return (
                    <Pressable
                      key={p.id}
                      style={[styles.planCard, active && styles.planCardActive]}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setSelected(p.id);
                      }}
                      testID={`plan-${p.id}`}
                    >
                      {p.best_value && (
                        <View style={styles.bestTag}>
                          <Text style={styles.bestText}>⭐ {t.bestValue}</Text>
                        </View>
                      )}
                      <View style={styles.planRow}>
                        <View style={[styles.radio, active && styles.radioActive]}>{active && <View style={styles.radioDot} />}</View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.planName}>{p.id === "yearly" ? t.planYearly : t.planMonthly}</Text>
                          {p.trial_days > 0 && <Text style={styles.planTrial}>🎁 {t.freeTrial}</Text>}
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={styles.planPrice}>{price(p)}</Text>
                          <Text style={styles.planPeriod}>{p.id === "yearly" ? t.perYear : t.perMonth}</Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>

            <Pressable style={[styles.cta, busy && styles.disabled]} onPress={subscribe} disabled={busy || !plan} testID="paywall-cta">
              <Text style={styles.ctaText}>{selected === "yearly" ? t.startTrial : t.subscribeNow}</Text>
            </Pressable>
            {plan && (
              <Text style={styles.ctaHint}>
                {selected === "yearly" ? `${t.freeTrial} · ${price(plan)} ${t.perYear}` : `${price(plan)} ${t.perMonth}`}
              </Text>
            )}

            {DEV_MODE && (
              <Pressable style={styles.testBtn} onPress={activateTest} disabled={busy} testID="paywall-activate-test">
                {busy ? <ActivityIndicator color={colors.onSurface} /> : <Text style={styles.testText}>🧪 {t.activateTest}</Text>}
              </Pressable>
            )}
          </>
        )}

        <View style={styles.footer}>
          <Pressable onPress={() => showToast(t.comingSoon)} style={styles.footerBtn} testID="paywall-terms">
            <Text style={styles.footerLink}>{t.terms}</Text>
          </Pressable>
          <Text style={styles.footerDot}>·</Text>
          <Pressable onPress={() => showToast(t.comingSoon)} style={styles.footerBtn} testID="paywall-privacy">
            <Text style={styles.footerLink}>{t.privacy}</Text>
          </Pressable>
          <Text style={styles.footerDot}>·</Text>
          <Pressable onPress={() => showToast(t.nothingToRestore)} style={styles.footerBtn} testID="paywall-restore">
            <Text style={styles.footerLink}>{t.restorePurchases}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={storeInfo} transparent animationType="fade" onRequestClose={() => setStoreInfo(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard} testID="paywall-store-modal">
            <Text style={styles.modalIcon}>🛒</Text>
            <Text style={styles.modalText}>{t.storeOnly}</Text>
            {plan && <Text style={styles.modalProduct}>{plan.product_id}</Text>}
            {DEV_MODE && (
              <Pressable style={styles.cta} onPress={activateTest} disabled={busy} testID="paywall-store-activate-test">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.ctaText}>🧪 {t.activateTest}</Text>}
              </Pressable>
            )}
            <Pressable style={styles.ghostBtn} onPress={() => setStoreInfo(false)} testID="paywall-store-close">
              <Text style={styles.ghostText}>{t.cancel}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={success} transparent animationType="fade" onRequestClose={() => setSuccess(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard} testID="paywall-success">
            <Text style={styles.modalIcon}>🎉</Text>
            <Text style={styles.modalTitle}>{t.premiumActivated}</Text>
            <Text style={styles.modalText}>{t.premiumActiveDesc}</Text>
            <Pressable
              style={styles.cta}
              onPress={() => {
                setSuccess(false);
                goBack();
              }}
              testID="paywall-success-close"
            >
              <Text style={styles.ctaText}>{t.continue}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: colors.surfaceSecondary },
  closeText: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  devTag: { color: colors.warning, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", borderWidth: 1, borderColor: colors.warning, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  hero: { borderRadius: radius.lg, padding: spacing.xl, alignItems: "center", gap: spacing.sm },
  crown: { fontSize: 48 },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800", textAlign: "center" },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
  avatarRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap", justifyContent: "center" },
  avatarWrap: { width: 48, height: 48 },
  avatarImg: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceTertiary },
  lockBadge: { position: "absolute", right: -4, bottom: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  lockText: { fontSize: 11 },
  toast: { alignSelf: "center", backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  toastText: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  reasonBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.warning, gap: 4 },
  reasonTitle: { color: colors.warning, fontWeight: "800", fontSize: 14 },
  reasonText: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  benefits: { gap: spacing.md },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  checkCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.brandPrimary },
  check: { color: colors.brandPrimary, fontWeight: "900" },
  benefitText: { color: colors.onSurface, fontSize: 15, fontWeight: "600", flex: 1 },
  plans: { gap: spacing.md },
  planCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 2, borderColor: colors.border },
  planCardActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  bestTag: { position: "absolute", top: -12, right: spacing.md, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  bestText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: "800" },
  planRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  radioActive: { borderColor: colors.brandPrimary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.brandPrimary },
  planName: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  planTrial: { color: colors.success, fontSize: 12, fontWeight: "700", marginTop: 2 },
  planPrice: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  planPeriod: { color: colors.onSurfaceTertiary, fontSize: 11 },
  cta: { backgroundColor: colors.brandPrimary, minHeight: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 16 },
  ctaHint: { color: colors.onSurfaceTertiary, fontSize: 12, textAlign: "center", marginTop: -spacing.sm },
  disabled: { opacity: 0.5 },
  testBtn: { minHeight: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surfaceSecondary },
  testText: { color: colors.warning, fontWeight: "800", fontSize: 14 },
  activeCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.success, gap: spacing.xs },
  activeLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  activePlan: { color: colors.success, fontSize: 18, fontWeight: "800" },
  activeMeta: { color: colors.onSurfaceSecondary, fontSize: 13 },
  ghostBtn: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  ghostText: { color: colors.onSurfaceTertiary, fontWeight: "700" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: spacing.xs },
  footerBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.xs },
  footerLink: { color: colors.onSurfaceTertiary, fontSize: 12, textDecorationLine: "underline" },
  footerDot: { color: colors.muted },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  modalIcon: { fontSize: 44 },
  modalTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "800", textAlign: "center" },
  modalText: { color: colors.onSurfaceSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
  modalProduct: { color: colors.muted, fontSize: 11, letterSpacing: 0.5 },
});
