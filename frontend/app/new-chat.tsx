import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, TextInput, Linking, Platform, KeyboardAvoidingView } from "react-native";
import * as Contacts from "expo-contacts";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { digitsOnly } from "@/src/components/ContactPicker";

type PermState = "checking" | "undetermined" | "granted" | "denied" | "blocked" | "unsupported";
type Match = { id: string; name: string; phone: string; photo_url?: string | null; matched_phone: string };

/** Pick a device contact who already uses SignBridge (or type a number) and open a 1:1 chat. */
export default function NewChat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLang();
  const [perm, setPerm] = useState<PermState>("checking");
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") {
      setPerm("unsupported");
      return;
    }
    Contacts.getPermissionsAsync()
      .then((res) => {
        if (res.granted) {
          setPerm("granted");
          loadMatches();
        } else if (res.canAskAgain) setPerm("undetermined");
        else setPerm("blocked");
      })
      .catch(() => setPerm("unsupported"));
  }, []);

  const loadMatches = async () => {
    setLoading(true);
    try {
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      const phones: string[] = [];
      const names = new Map<string, string>();
      for (const c of data) {
        for (const p of c.phoneNumbers ?? []) {
          if (p.number) {
            phones.push(p.number);
            names.set(digitsOnly(p.number), c.name ?? p.number);
          }
        }
      }
      const res = await api.chatMatch(phones);
      setMatches(res.items.map((m: Match) => ({ ...m, name: names.get(digitsOnly(m.matched_phone)) ?? m.name })));
    } catch (e) {
      console.warn("match", e);
    } finally {
      setLoading(false);
    }
  };

  const requestPerm = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const res = await Contacts.requestPermissionsAsync();
    if (res.granted) {
      setPerm("granted");
      loadMatches();
    } else setPerm(res.canAskAgain ? "denied" : "blocked");
  };

  const open = async (payload: { peer_id?: string; phone?: string }, key: string, name?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOpening(key);
    setError(null);
    try {
      const conv = await api.openConversation(payload);
      router.replace({ pathname: "/chat/[id]", params: { id: conv.id, name: name ?? conv.peer?.name ?? "" } });
    } catch (e: any) {
      setError(e?.message?.includes("404") || e?.message?.includes("registrado") ? t.notRegistered : e?.message ?? t.notRegistered);
    } finally {
      setOpening(null);
    }
  };

  const renderManual = () => (
    <View style={styles.manual} testID="new-chat-manual">
      <Text style={styles.manualLabel}>{t.orTypeNumber}</Text>
      <View style={styles.manualRow}>
        <TextInput
          style={styles.input}
          value={manual}
          onChangeText={setManual}
          placeholder="+52 55 1234 5678"
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
          testID="new-chat-phone"
          onSubmitEditing={() => digitsOnly(manual).length >= 7 && open({ phone: manual }, "manual")}
        />
        <Pressable
          style={[styles.goBtn, digitsOnly(manual).length < 7 && styles.disabled]}
          disabled={digitsOnly(manual).length < 7 || opening === "manual"}
          onPress={() => open({ phone: manual }, "manual")}
          testID="new-chat-phone-go"
        >
          {opening === "manual" ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.goText}>➤</Text>}
        </Pressable>
      </View>
      {error && <Text style={styles.error} testID="new-chat-error">{error}</Text>}
    </View>
  );

  const renderBody = () => {
    if (perm === "checking") return <ActivityIndicator color={colors.brandPrimary} style={{ margin: spacing.xl }} />;
    if (perm === "undetermined" || perm === "denied" || perm === "blocked") {
      return (
        <View style={styles.permBox} testID="new-chat-perm">
          <Text style={styles.permIcon}>👥</Text>
          <Text style={styles.permTitle}>{t.permContacts}</Text>
          <Text style={styles.permDesc}>{perm === "blocked" ? t.contactsBlocked : t.contactsForChat}</Text>
          <Pressable style={styles.primaryBtn} onPress={() => (perm === "blocked" ? Linking.openSettings() : requestPerm())} testID="new-chat-request-contacts">
            <Text style={styles.primaryText}>{perm === "blocked" ? t.openSettings : t.grantAccess}</Text>
          </Pressable>
          {renderManual()}
        </View>
      );
    }
    if (perm === "unsupported") return <View style={styles.permBox}>{renderManual()}</View>;
    return (
      <FlatList
        data={matches}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={styles.sectionTitle}>
            {loading ? t.searchingContacts : `${t.onSignBridge} · ${matches.length}`}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => open({ peer_id: item.id }, item.id, item.name)} testID={`match-${item.id}`}>
            {item.photo_url ? (
              <Image source={{ uri: item.photo_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarText}>{item.name[0]?.toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.phone}>{item.matched_phone}</Text>
            </View>
            {opening === item.id ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.chevron}>›</Text>}
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? <ActivityIndicator color={colors.brandPrimary} style={{ margin: spacing.xl }} /> : <Text style={styles.empty}>{t.noMatchedContacts}</Text>
        }
        ListFooterComponent={renderManual()}
      />
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} testID="new-chat-back">
            <Text style={styles.backText}>←</Text>
          </Pressable>
          <Text style={styles.title} testID="new-chat-title">{t.newChat}</Text>
          <View style={{ width: 44 }} />
        </View>
        {renderBody()}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.onSurface, fontSize: 24 },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  sectionTitle: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginVertical: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, minHeight: 60 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary },
  avatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary },
  avatarText: { color: colors.onBrandTertiary, fontWeight: "800" },
  name: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  phone: { color: colors.onSurfaceTertiary, fontSize: 12 },
  chevron: { color: colors.muted, fontSize: 22 },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.lg, lineHeight: 20 },
  permBox: { alignItems: "center", gap: spacing.sm, padding: spacing.lg },
  permIcon: { fontSize: 40 },
  permTitle: { color: colors.onSurface, fontWeight: "800", fontSize: 16 },
  permDesc: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: "center", lineHeight: 18 },
  primaryBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, minHeight: 44, borderRadius: radius.pill, justifyContent: "center", alignItems: "center" },
  primaryText: { color: colors.onBrandPrimary, fontWeight: "800" },
  manual: { width: "100%", marginTop: spacing.lg, gap: spacing.sm },
  manualLabel: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  manualRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, color: colors.onSurface, height: 48, borderWidth: 1, borderColor: colors.border },
  goBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  goText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 18 },
  disabled: { opacity: 0.4 },
  error: { color: colors.error, fontSize: 13, fontWeight: "600" },
});
