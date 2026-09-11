import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera } from "expo-camera";
import * as Contacts from "expo-contacts";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";

type PermState = "idle" | "granted" | "denied";

export default function Permissions() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLang();
  const [cam, setCam] = useState<PermState>("idle");
  const [mic, setMic] = useState<PermState>("idle");
  const [contacts, setContacts] = useState<PermState>("idle");
  const [showFallback, setShowFallback] = useState(false);

  const requestCamera = async () => {
    const res = await Camera.requestCameraPermissionsAsync();
    setCam(res.granted ? "granted" : "denied");
    if (!res.granted) setShowFallback(true);
  };
  const requestMic = async () => {
    const res = await Camera.requestMicrophonePermissionsAsync();
    setMic(res.granted ? "granted" : "denied");
    if (!res.granted) setShowFallback(true);
  };
  const requestContacts = async () => {
    const res = await Contacts.requestPermissionsAsync();
    setContacts(res.granted ? "granted" : "denied");
    if (!res.granted) setShowFallback(true);
  };

  const grantAll = async () => {
    await requestCamera();
    await requestMic();
    await requestContacts();
  };

  const done = () => router.replace("/(tabs)/translator");

  const rows: {
    key: string;
    icon: string;
    title: string;
    desc: string;
    state: PermState;
    onPress: () => void;
    testID: string;
  }[] = [
    { key: "cam", icon: "📹", title: t.permCamera, desc: t.permCameraDesc, state: cam, onPress: requestCamera, testID: "perm-camera" },
    { key: "mic", icon: "🎤", title: t.permMic, desc: t.permMicDesc, state: mic, onPress: requestMic, testID: "perm-mic" },
    { key: "contacts", icon: "👥", title: t.permContacts, desc: t.permContactsDesc, state: contacts, onPress: requestContacts, testID: "perm-contacts" },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <ScrollView contentContainerStyle={styles.inner}>
        <Text style={styles.title}>{t.permissions}</Text>
        <Text style={styles.subtitle}>
          SignBridge {t.permissions.toLowerCase()}
        </Text>

        <View style={styles.list}>
          {rows.map((r) => (
            <Pressable key={r.key} style={styles.row} onPress={r.onPress} testID={r.testID}>
              <Text style={styles.rowIcon}>{r.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{r.title}</Text>
                <Text style={styles.rowDesc}>{r.desc}</Text>
              </View>
              <View style={[styles.state, r.state === "granted" && styles.stateGranted, r.state === "denied" && styles.stateDenied]}>
                <Text style={styles.stateText}>
                  {r.state === "granted" ? "✓" : r.state === "denied" ? "!" : "→"}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        {showFallback && (
          <View style={styles.fallback} testID="permission-fallback">
            <Text style={styles.fallbackTitle}>⚠️ Habilitar permisos</Text>
            <Text style={styles.fallbackText}>
              Algunos permisos fueron rechazados. Ábrelos desde los ajustes del sistema para usar todas las funciones.
            </Text>
            <Pressable onPress={() => Linking.openSettings()} style={styles.fallbackBtn}>
              <Text style={styles.fallbackBtnText}>Abrir ajustes</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.primary} onPress={grantAll} testID="grant-all-btn">
          <Text style={styles.primaryText}>{t.grantAccess}</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={done} testID="skip-btn">
          <Text style={styles.secondaryText}>{t.skipForNow}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.xl },
  inner: { paddingBottom: spacing.xl },
  title: { color: colors.onSurface, fontSize: 30, fontWeight: "800" },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 15, marginTop: spacing.sm, marginBottom: spacing.xl },
  list: { gap: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowIcon: { fontSize: 32 },
  rowTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "700" },
  rowDesc: { color: colors.onSurfaceTertiary, fontSize: 13, marginTop: 2 },
  state: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  stateGranted: { backgroundColor: colors.success },
  stateDenied: { backgroundColor: colors.warning },
  stateText: { color: colors.onSurface, fontWeight: "800" },
  fallback: {
    marginTop: spacing.xl,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
  },
  fallbackTitle: { color: colors.brandPrimary, fontSize: 15, fontWeight: "800" },
  fallbackText: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: spacing.sm },
  fallbackBtn: { marginTop: spacing.md, alignSelf: "flex-start", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.pill },
  fallbackBtnText: { color: colors.onBrandPrimary, fontWeight: "700" },
  footer: { gap: spacing.sm },
  primary: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: colors.onBrandPrimary, fontSize: 17, fontWeight: "700" },
  secondary: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: colors.muted, fontSize: 15 },
});
