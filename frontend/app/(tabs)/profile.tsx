import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Modal,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, clearToken } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { Lang } from "@/src/constants";

export default function Profile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, lang, setLang } = useLang();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const u = await api.me();
      setUser(u);
      setName(u.name || "");
      setPhoto(u.photo_url || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!res.canceled && res.assets[0]) setPhoto(res.assets[0].uri);
  };

  const saveEdit = async () => {
    const updated = await api.updateProfile({ name: name.trim(), photo_url: photo });
    setUser(updated);
    setEditing(false);
  };

  const changeLang = async (l: Lang) => {
    setLang(l);
    try {
      const updated = await api.updateProfile({ language: l });
      setUser(updated);
    } catch {}
  };

  const logout = async () => {
    await clearToken();
    router.replace("/phone");
  };

  if (loading || !user) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      <View style={styles.header}>
        <Text style={styles.title} testID="profile-title">{t.profile}</Text>
      </View>

      <View style={styles.hero}>
        <View style={styles.avatar}>
          {user.photo_url ? (
            <Image source={{ uri: user.photo_url }} style={{ width: "100%", height: "100%" }} />
          ) : (
            <Text style={styles.avatarInit}>{(user.name?.[0] || user.phone?.slice(-2) || "U").toUpperCase()}</Text>
          )}
        </View>
        <Text style={styles.name}>{user.name || "Anonymous"}</Text>
        <Text style={styles.phone}>{user.phone}</Text>
        <Pressable onPress={() => setEditing(true)} style={styles.editBtn} testID="edit-profile-btn">
          <Text style={styles.editText}>✎ {t.editProfile}</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.language}</Text>
        <View style={styles.langRow}>
          <Pressable
            style={[styles.langCard, lang === "es" && styles.langCardActive]}
            onPress={() => changeLang("es")}
            testID="profile-lang-es"
          >
            <Text style={styles.flag}>🇲🇽</Text>
            <Text style={[styles.langName, lang === "es" && styles.langNameActive]}>Español (LSM)</Text>
          </Pressable>
          <Pressable
            style={[styles.langCard, lang === "en" && styles.langCardActive]}
            onPress={() => changeLang("en")}
            testID="profile-lang-en"
          >
            <Text style={styles.flag}>🇺🇸</Text>
            <Text style={[styles.langName, lang === "en" && styles.langNameActive]}>English (ASL)</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.settings}</Text>
        <Pressable style={styles.settingRow} onPress={() => router.push("/favorites")} testID="settings-favorites">
          <Text style={styles.settingIcon}>⭐</Text>
          <Text style={styles.settingLabel}>{t.manageFavorites}</Text>
          <Text style={styles.chev}>›</Text>
        </Pressable>
        <Pressable style={styles.settingRow} onPress={() => router.push("/permissions")} testID="settings-permissions">
          <Text style={styles.settingIcon}>🔐</Text>
          <Text style={styles.settingLabel}>{t.permissions}</Text>
          <Text style={styles.chev}>›</Text>
        </Pressable>
        <Pressable style={styles.settingRow} onPress={logout} testID="logout-btn">
          <Text style={styles.settingIcon}>🚪</Text>
          <Text style={[styles.settingLabel, { color: colors.error }]}>{t.logout}</Text>
          <Text style={styles.chev}>›</Text>
        </Pressable>
      </View>

      <Modal visible={editing} animationType="slide" transparent onRequestClose={() => setEditing(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t.editProfile}</Text>
              <Pressable onPress={() => setEditing(false)} style={styles.modalClose}><Text style={{ color: colors.onSurface, fontSize: 20 }}>✕</Text></Pressable>
            </View>
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <Pressable style={styles.photoWrap} onPress={pickPhoto}>
                {photo ? <Image source={{ uri: photo }} style={{ width: 120, height: 120, borderRadius: 60 }} /> : <Text style={styles.avatarInit}>{name[0]?.toUpperCase() || "?"}</Text>}
              </Pressable>
              <TextInput
                value={name}
                onChangeText={setName}
                style={styles.input}
                placeholder={t.yourName}
                placeholderTextColor={colors.muted}
              />
              <Pressable style={styles.primary} onPress={saveEdit} testID="save-edit">
                <Text style={styles.primaryText}>{t.save}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  hero: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },
  avatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarInit: { color: colors.brandPrimary, fontSize: 40, fontWeight: "800" },
  name: { color: colors.onSurface, fontSize: 22, fontWeight: "800", marginTop: spacing.sm },
  phone: { color: colors.onSurfaceTertiary, fontSize: 14 },
  editBtn: { marginTop: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  editText: { color: colors.onSurface, fontWeight: "700" },
  section: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  sectionTitle: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm },
  langRow: { flexDirection: "row", gap: spacing.md },
  langCard: { flex: 1, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, alignItems: "center", gap: spacing.xs },
  langCardActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  flag: { fontSize: 28 },
  langName: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  langNameActive: { color: colors.brandPrimary },
  settingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  settingIcon: { fontSize: 22 },
  settingLabel: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  chev: { color: colors.muted, fontSize: 22 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  modalClose: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  photoWrap: { alignSelf: "center", width: 120, height: 120, borderRadius: 60, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 2, borderColor: colors.border, borderStyle: "dashed" },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, color: colors.onSurface, height: 56, borderWidth: 1, borderColor: colors.border, fontSize: 16 },
  primary: { backgroundColor: colors.brandPrimary, height: 56, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 16 },
});
