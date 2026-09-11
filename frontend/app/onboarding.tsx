import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { Lang } from "@/src/constants";

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, lang: contextLang, setLang } = useLang();
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [lang, setLangLocal] = useState<Lang>(contextLang);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0].uri);
    }
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Ingresa tu nombre / Enter your name");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      setLang(lang);
      await api.onboard(name.trim(), photo, lang);
      router.replace("/permissions");
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
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{lang === "es" ? "Crea tu perfil" : "Create your profile"}</Text>
        <Text style={styles.subtitle}>{lang === "es" ? "Cuéntanos un poco sobre ti" : "Tell us a little about you"}</Text>

        <Pressable style={styles.photoWrap} onPress={pickPhoto} testID="pick-photo">
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photo} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoIcon}>📷</Text>
              <Text style={styles.photoLabel}>{t.profilePhoto}</Text>
            </View>
          )}
        </Pressable>

        <Text style={styles.label}>{t.yourName}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          style={styles.input}
          placeholder={lang === "es" ? "María López" : "John Smith"}
          placeholderTextColor={colors.muted}
          testID="name-input"
        />

        <Text style={styles.label}>{t.preferredLanguage}</Text>
        <View style={styles.langRow}>
          <Pressable
            style={[styles.langCard, lang === "es" && styles.langCardActive]}
            onPress={() => setLangLocal("es")}
            testID="lang-es"
          >
            <Text style={styles.flag}>🇲🇽</Text>
            <Text style={[styles.langName, lang === "es" && styles.langNameActive]}>Español</Text>
            <Text style={styles.langSub}>LSM</Text>
          </Pressable>
          <Pressable
            style={[styles.langCard, lang === "en" && styles.langCardActive]}
            onPress={() => setLangLocal("en")}
            testID="lang-en"
          >
            <Text style={styles.flag}>🇺🇸</Text>
            <Text style={[styles.langName, lang === "en" && styles.langNameActive]}>English</Text>
            <Text style={styles.langSub}>ASL</Text>
          </Pressable>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.primary} onPress={submit} disabled={loading} testID="continue-btn">
          {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>{t.continue}</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  inner: { padding: spacing.xl },
  title: { color: colors.onSurface, fontSize: 30, fontWeight: "800" },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 15, marginTop: spacing.sm, marginBottom: spacing.xl },
  photoWrap: { alignSelf: "center", marginVertical: spacing.lg },
  photo: { width: 120, height: 120, borderRadius: 60 },
  photoPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  photoIcon: { fontSize: 28 },
  photoLabel: { color: colors.onSurfaceTertiary, fontSize: 11 },
  label: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600", marginBottom: spacing.sm, marginTop: spacing.md, textTransform: "uppercase", letterSpacing: 1 },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    color: colors.onSurface,
    fontSize: 17,
    height: 56,
  },
  langRow: { flexDirection: "row", gap: spacing.md },
  langCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.xs,
  },
  langCardActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  flag: { fontSize: 32 },
  langName: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  langNameActive: { color: colors.brandPrimary },
  langSub: { color: colors.onSurfaceTertiary, fontSize: 12 },
  error: { color: colors.error, marginTop: spacing.md },
  primary: {
    marginTop: spacing.xxl,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: colors.onBrandPrimary, fontSize: 17, fontWeight: "700" },
});
