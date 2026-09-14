import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, saveToken } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";

export default function Otp() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { phone, code, mode } = useLocalSearchParams<{ phone: string; code: string; mode?: string }>();
  const { t } = useLang();
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timer, setTimer] = useState(30);
  const refs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    const iv = setInterval(() => setTimer((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(iv);
  }, []);

  const setDigit = (i: number, v: string) => {
    const digit = v.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[i] = digit;
    setOtp(next);
    if (digit && i < 5) refs.current[i + 1]?.focus();
    if (next.every((d) => d)) verify(next.join(""));
  };

  const onBackspace = (i: number) => {
    if (!otp[i] && i > 0) refs.current[i - 1]?.focus();
  };

  const verify = async (fullOtp: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.verifyOtp(phone, code, fullOtp);
      await saveToken(res.token);
      if (res.new_user) {
        router.replace("/onboarding");
      } else {
        router.replace("/(tabs)/translator");
      }
    } catch (e: any) {
      setError(e.message);
      setOtp(["", "", "", "", "", ""]);
      refs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (timer > 0) return;
    await api.sendOtp(phone, code);
    setTimer(30);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.inner, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="otp-back">
          <Text style={styles.backText}>← </Text>
        </Pressable>

        <View style={styles.hero}>
          <Text style={styles.title}>{t.enterOtp}</Text>
          <Text style={styles.subtitle}>
            {t.otpSentTo} {code} {phone}
          </Text>
          {mode === "test" ? (
            <Text style={styles.hint} testID="otp-test-hint">Número de prueba · código 123456</Text>
          ) : (
            <Text style={styles.hint} testID="otp-sms-hint">Te enviamos un SMS con tu código</Text>
          )}
        </View>

        <View style={styles.otpRow}>
          {otp.map((d, i) => (
            <TextInput
              key={i}
              ref={(r) => {
                refs.current[i] = r;
              }}
              value={d}
              onChangeText={(v) => setDigit(i, v)}
              onKeyPress={(e) => {
                if (e.nativeEvent.key === "Backspace") onBackspace(i);
              }}
              keyboardType="number-pad"
              maxLength={1}
              style={styles.otpBox}
              testID={`otp-${i}`}
            />
          ))}
        </View>

        {error && <Text style={styles.error} testID="otp-error">{error}</Text>}
        {loading && <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.lg }} />}

        <View style={{ flex: 1 }} />

        <Pressable onPress={resend} disabled={timer > 0} style={styles.resendBtn} testID="resend-btn">
          <Text style={[styles.resendText, timer === 0 && styles.resendActive]}>
            {timer > 0 ? `${t.resendIn} ${timer}s` : t.resend}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  inner: { flex: 1, paddingHorizontal: spacing.xl },
  back: { width: 44, height: 44, justifyContent: "center" },
  backText: { color: colors.onSurface, fontSize: 24 },
  hero: { marginTop: spacing.lg, marginBottom: spacing.xxl },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: "800" },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 15, marginTop: spacing.sm },
  hint: { color: colors.brandPrimary, fontSize: 13, marginTop: spacing.sm, fontWeight: "600" },
  otpRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  otpBox: {
    flex: 1,
    height: 64,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.onSurface,
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
  },
  error: { color: colors.error, marginTop: spacing.md, textAlign: "center" },
  resendBtn: { alignItems: "center", padding: spacing.md },
  resendText: { color: colors.muted, fontSize: 15 },
  resendActive: { color: colors.brandPrimary, fontWeight: "700" },
});
