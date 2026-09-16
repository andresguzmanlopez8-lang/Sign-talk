import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { formatTime } from "@/src/components/ChatBubble";

type Conversation = {
  id: string;
  peer: { id: string; name: string; phone: string; photo_url?: string | null } | null;
  last_message: { text: string; kind: "text" | "voice" | "sign"; sender_id: string; created_at: string } | null;
  unread_count: number;
  updated_at: string;
};

const KIND_ICON = { text: "💬", voice: "🎤", sign: "👐" };
const POLL_MS = 4000;

export default function Chats() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLang();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.conversations());
    } catch (e) {
      console.warn("conversations", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      timer.current = setInterval(load, POLL_MS);
      return () => {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
      };
    }, [load])
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const open = (c: Conversation) => {
    Haptics.selectionAsync().catch(() => {});
    router.push({ pathname: "/chat/[id]", params: { id: c.id, name: c.peer?.name ?? "" } });
  };

  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    return d.toDateString() === today.toDateString() ? formatTime(iso) : d.toLocaleDateString();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title} testID="chats-title">💬 {t.chats}</Text>
        <Pressable style={styles.newBtn} onPress={() => router.push("/new-chat")} testID="new-chat-btn">
          <Text style={styles.newBtnText}>+ {t.newChat}</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandPrimary} />}
          renderItem={({ item }) => {
            const name = item.peer?.name ?? "?";
            const last = item.last_message;
            return (
              <Pressable style={styles.row} onPress={() => open(item)} testID={`conversation-${item.id}`}>
                {item.peer?.photo_url ? (
                  <Image source={{ uri: item.peer.photo_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarText}>{name[0]?.toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <Text style={styles.name} numberOfLines={1}>{name}</Text>
                    {last && <Text style={styles.time}>{fmtDay(last.created_at)}</Text>}
                  </View>
                  <View style={styles.rowBottom}>
                    <Text style={[styles.preview, item.unread_count > 0 && styles.previewUnread]} numberOfLines={1}>
                      {last ? `${last.sender_id !== item.peer?.id ? `${t.you}: ` : ""}${KIND_ICON[last.kind]} ${last.text}` : t.chatEmpty}
                    </Text>
                    {item.unread_count > 0 && (
                      <View style={styles.badge} testID={`unread-${item.id}`}>
                        <Text style={styles.badgeText}>{item.unread_count}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty} testID="chats-empty">
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTitle}>{t.noChats}</Text>
              <Text style={styles.emptyDesc}>{t.noChatsDesc}</Text>
              <Pressable style={styles.primaryBtn} onPress={() => router.push("/new-chat")} testID="empty-new-chat">
                <Text style={styles.primaryText}>+ {t.newChat}</Text>
              </Pressable>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  newBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, minHeight: 40, borderRadius: radius.pill, justifyContent: "center" },
  newBtnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 13 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm, flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, minHeight: 72 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceTertiary },
  avatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary },
  avatarText: { color: colors.onBrandTertiary, fontWeight: "800", fontSize: 18 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm, marginTop: 2 },
  name: { color: colors.onSurface, fontWeight: "800", fontSize: 15, flex: 1 },
  time: { color: colors.onSurfaceTertiary, fontSize: 11 },
  preview: { color: colors.onSurfaceTertiary, fontSize: 13, flex: 1 },
  previewUnread: { color: colors.onSurface, fontWeight: "700" },
  badge: { backgroundColor: colors.brandPrimary, minWidth: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: "800" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  emptyIcon: { fontSize: 56 },
  emptyTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyDesc: { color: colors.onSurfaceTertiary, fontSize: 14, textAlign: "center", lineHeight: 20 },
  primaryBtn: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, minHeight: 48, borderRadius: radius.pill, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontWeight: "800" },
});
