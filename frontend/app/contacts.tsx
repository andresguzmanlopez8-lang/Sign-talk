import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";

type UserContact = {
  id: string;
  displayName: string;
  profileImageUrl?: string | null;
  phone?: string | null;
  lastSyncDate: string;
  isSavedLocally: boolean;
};

// Demo profile used by the Preview panel to exercise the Contacts Manager automation.
const DEMO_PROFILE = {
  profileId: "demo-andy",
  displayName: "Andy",
  profileImageUrl: "https://i.pravatar.cc/150?u=andy-signbridge",
  phone: "+52 55 0000 0001",
};

export default function SyncedContacts() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, lang } = useLang();
  const [items, setItems] = useState<UserContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [banner, setBanner] = useState<{ text: string; created: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.contacts());
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  /** Simulates opening the "Andy" profile → backend Contacts Manager auto-saves it on first access. */
  const simulateProfileView = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSimulating(true);
    setBanner(null);
    try {
      const res = await api.viewContact(DEMO_PROFILE);
      setBanner({ text: res.created ? t.contactSynced : t.contactAlreadySynced, created: res.created });
      await load();
    } catch (e) {
      console.warn(e);
    } finally {
      setSimulating(false);
    }
  };

  const remove = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setItems((prev) => prev.filter((c) => c.id !== id));
    try {
      await api.deleteContact(id);
    } catch (e) {
      console.warn(e);
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US");

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="contacts-back">
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.title} testID="contacts-title">👥 {t.syncedContacts}</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.previewCard} testID="preview-panel">
        <Text style={styles.previewLabel}>PREVIEW · Contacts Manager</Text>
        <View style={styles.previewRow}>
          <Image source={{ uri: DEMO_PROFILE.profileImageUrl }} style={styles.previewAvatar} />
          <View style={{ flex: 1 }}>
            <Text style={styles.previewName}>{DEMO_PROFILE.displayName}</Text>
            <Text style={styles.previewPhone}>{DEMO_PROFILE.phone}</Text>
          </View>
        </View>
        <Pressable style={[styles.primaryBtn, simulating && styles.disabled]} onPress={simulateProfileView} disabled={simulating} testID="simulate-profile-view">
          {simulating ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>👁️ {t.simulateProfileView}</Text>}
        </Pressable>
        {banner && (
          <View style={[styles.banner, !banner.created && styles.bannerMuted]} testID="sync-confirmation">
            <Text style={[styles.bannerText, !banner.created && { color: colors.onSurfaceTertiary }]}>
              {banner.created ? "✅" : "ℹ️"} {banner.text}
            </Text>
          </View>
        )}
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
          renderItem={({ item }) => (
            <View style={styles.row} testID={`contact-row-${item.id}`}>
              {item.profileImageUrl ? (
                <Image source={{ uri: item.profileImageUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarText}>{item.displayName[0]?.toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name} testID={`contact-name-${item.id}`}>{item.displayName}</Text>
                <Text style={styles.meta}>{t.lastSync}: {fmt(item.lastSyncDate)}</Text>
                {item.isSavedLocally && <Text style={styles.savedTag}>💾 {t.savedLocally}</Text>}
              </View>
              <Pressable style={styles.deleteBtn} onPress={() => remove(item.id)} testID={`contact-delete-${item.id}`}>
                <Text style={{ color: colors.error, fontSize: 18 }}>🗑</Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>{t.noSyncedContacts}</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.onSurface, fontSize: 24 },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  previewCard: { margin: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  previewLabel: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  previewAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceTertiary },
  previewName: { color: colors.onSurface, fontWeight: "800", fontSize: 16 },
  previewPhone: { color: colors.onSurfaceTertiary, fontSize: 12 },
  primaryBtn: { backgroundColor: colors.brandPrimary, minHeight: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontWeight: "800" },
  disabled: { opacity: 0.6 },
  banner: { backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.success },
  bannerMuted: { borderColor: colors.border },
  bannerText: { color: colors.success, fontWeight: "800", fontSize: 14, textAlign: "center" },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary },
  avatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary },
  avatarText: { color: colors.onBrandTertiary, fontWeight: "800" },
  name: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  meta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  savedTag: { color: colors.success, fontSize: 11, fontWeight: "700", marginTop: 2 },
  deleteBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.xl, lineHeight: 20 },
});
