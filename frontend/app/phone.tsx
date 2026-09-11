import { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { COUNTRIES } from "@/src/constants";
import { useLang } from "@/src/lang";

export default function Phone() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, lang, setLang } = useLang();
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [phone, setPhone] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () =>
      COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.code.includes(search)
      ),
    [search]
  );

  const canSubmit = phone.trim().length >= 7 && !loading;

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await api.sendOtp(phone.trim(), country.code);
      router.push({
        pathname: "/otp",
        params: { phone: phone.trim(), code: country.code },
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.inner, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.header}>
          <Pressable
            style={styles.langToggle}
            onPress={() => setLang(lang === "es" ? "en" : "es")}
            testID="lang-toggle"
          >
            <Text style={styles.langToggleText}>{lang === "es" ? "🇲🇽 ES" : "🇺🇸 EN"}</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.title}>{t.appName}</Text>
          <Text style={styles.subtitle}>{t.tagline}</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>{t.phone}</Text>
          <View style={styles.row}>
            <Pressable
              style={styles.codeBtn}
              onPress={() => setShowPicker(true)}
              testID="country-picker"
            >
              <Text style={styles.codeFlag}>{country.flag}</Text>
              <Text style={styles.codeText}>{country.code}</Text>
            </Pressable>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="555 123 4567"
              placeholderTextColor={colors.muted}
              testID="phone-input"
            />
          </View>
          {error && <Text style={styles.error} testID="phone-error">{error}</Text>}
        </View>

        <View style={{ flex: 1 }} />

        <Pressable
          style={[styles.primary, !canSubmit && styles.primaryDisabled]}
          onPress={submit}
          disabled={!canSubmit}
          testID="send-otp-button"
        >
          {loading ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text style={styles.primaryText}>{t.sendCode}</Text>
          )}
        </Pressable>
      </View>

      <Modal visible={showPicker} animationType="slide" onRequestClose={() => setShowPicker(false)}>
        <View style={[styles.modalContainer, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.modalHeader}>
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar país..."
              placeholderTextColor={colors.muted}
            />
            <Pressable onPress={() => setShowPicker(false)} style={styles.closeBtn} testID="close-picker">
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.code + c.name}
            renderItem={({ item }) => (
              <Pressable
                style={styles.countryRow}
                onPress={() => {
                  setCountry(item);
                  setShowPicker(false);
                  setSearch("");
                }}
              >
                <Text style={styles.codeFlag}>{item.flag}</Text>
                <Text style={styles.countryName}>{item.name}</Text>
                <Text style={styles.countryCode}>{item.code}</Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  inner: { flex: 1, paddingHorizontal: spacing.xl },
  header: { flexDirection: "row", justifyContent: "flex-end" },
  langToggle: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  langToggleText: { color: colors.onSurface, fontWeight: "600" },
  hero: { marginTop: spacing.xxxl, marginBottom: spacing.xxl },
  title: { color: colors.onSurface, fontSize: 40, fontWeight: "800", letterSpacing: -1 },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 16, marginTop: spacing.sm },
  form: {},
  label: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600", marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 1 },
  row: { flexDirection: "row", gap: spacing.sm },
  codeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    height: 56,
  },
  codeFlag: { fontSize: 20 },
  codeText: { color: colors.onSurface, fontWeight: "700", fontSize: 16 },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    color: colors.onSurface,
    fontSize: 18,
    height: 56,
  },
  error: { color: colors.error, marginTop: spacing.sm },
  primary: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { color: colors.onBrandPrimary, fontSize: 17, fontWeight: "700" },
  modalContainer: { flex: 1, backgroundColor: colors.surface },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    color: colors.onSurface,
    height: 48,
  },
  closeBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  closeText: { color: colors.onSurface, fontSize: 22 },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  countryName: { flex: 1, color: colors.onSurface, fontSize: 16 },
  countryCode: { color: colors.onSurfaceTertiary, fontWeight: "600" },
});
