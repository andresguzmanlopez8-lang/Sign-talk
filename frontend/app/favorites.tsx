import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";

type Favorite = { id: string; text: string; language: "es" | "en"; order?: number };

export default function FavoritesManager() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, lang } = useLang();
  const [filter, setFilter] = useState<"es" | "en">(lang);
  const [items, setItems] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Favorite | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.favorites(filter));
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    try {
      await api.reorderFavorites(next.map((f) => f.id));
    } catch (e) {
      console.warn(e);
    }
  };

  const remove = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConfirmId(null);
    setItems((prev) => prev.filter((f) => f.id !== id));
    try {
      await api.deleteFavorite(id);
    } catch (e) {
      console.warn(e);
    }
  };

  const saveRename = async () => {
    if (!editing || !editText.trim()) return;
    const text = editText.trim();
    setItems((prev) => prev.map((f) => (f.id === editing.id ? { ...f, text } : f)));
    setEditing(null);
    try {
      await api.renameFavorite(editing.id, text);
    } catch (e) {
      console.warn(e);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="favorites-back">
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.title} testID="favorites-title">⭐ {t.favorites}</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.filterRow}>
        {(["es", "en"] as const).map((l) => (
          <Pressable
            key={l}
            style={[styles.filterChip, filter === l && styles.filterChipActive]}
            onPress={() => setFilter(l)}
            testID={`fav-filter-${l}`}
          >
            <Text style={[styles.filterText, filter === l && styles.filterTextActive]}>{l === "es" ? "🇲🇽 LSM" : "🇺🇸 ASL"}</Text>
          </Pressable>
        ))}
        <Text style={styles.count} testID="fav-count">{items.length}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(f) => f.id}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <View style={styles.row} testID={`fav-row-${item.id}`}>
              <View style={styles.orderCol}>
                <Pressable
                  style={[styles.orderBtn, index === 0 && styles.disabled]}
                  disabled={index === 0}
                  onPress={() => move(index, -1)}
                  testID={`fav-up-${item.id}`}
                  accessibilityLabel={t.moveUp}
                >
                  <Text style={styles.orderText}>▲</Text>
                </Pressable>
                <Pressable
                  style={[styles.orderBtn, index === items.length - 1 && styles.disabled]}
                  disabled={index === items.length - 1}
                  onPress={() => move(index, 1)}
                  testID={`fav-down-${item.id}`}
                  accessibilityLabel={t.moveDown}
                >
                  <Text style={styles.orderText}>▼</Text>
                </Pressable>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowIndex}>#{index + 1}</Text>
                <Text style={styles.rowText} testID={`fav-text-${item.id}`}>{item.text}</Text>
                {confirmId === item.id && (
                  <View style={styles.confirmRow} testID={`fav-confirm-${item.id}`}>
                    <Text style={styles.confirmText}>{t.confirmDelete}</Text>
                    <Pressable style={styles.confirmYes} onPress={() => remove(item.id)} testID={`fav-confirm-yes-${item.id}`}>
                      <Text style={styles.confirmBtnText}>{t.yes}</Text>
                    </Pressable>
                    <Pressable style={styles.confirmNo} onPress={() => setConfirmId(null)} testID={`fav-confirm-no-${item.id}`}>
                      <Text style={styles.confirmBtnText}>{t.no}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
              <View style={styles.actionCol}>
                <Pressable
                  style={styles.actionBtn}
                  onPress={() => {
                    setEditing(item);
                    setEditText(item.text);
                  }}
                  testID={`fav-rename-${item.id}`}
                  accessibilityLabel={t.rename}
                >
                  <Text style={styles.actionText}>✎</Text>
                </Pressable>
                <Pressable
                  style={styles.actionBtn}
                  onPress={() => setConfirmId(confirmId === item.id ? null : item.id)}
                  testID={`fav-delete-${item.id}`}
                  accessibilityLabel={t.delete}
                >
                  <Text style={[styles.actionText, { color: colors.error }]}>🗑</Text>
                </Pressable>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>⭐</Text>
              <Text style={styles.emptyText}>{t.noFavoritesYet}</Text>
            </View>
          }
        />
      )}

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBg}>
          <View style={styles.modalCard} testID="rename-modal">
            <Text style={styles.modalTitle}>✎ {t.rename}</Text>
            <TextInput
              value={editText}
              onChangeText={setEditText}
              style={styles.input}
              multiline
              autoFocus
              placeholderTextColor={colors.muted}
              testID="rename-input"
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.secondaryBtn} onPress={() => setEditing(null)} testID="rename-cancel">
                <Text style={styles.secondaryText}>{t.cancel}</Text>
              </Pressable>
              <Pressable style={[styles.primaryBtn, !editText.trim() && styles.disabled]} disabled={!editText.trim()} onPress={saveRename} testID="rename-save">
                <Text style={styles.primaryText}>{t.save}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.onSurface, fontSize: 24 },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  filterRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, minHeight: 36, justifyContent: "center" },
  filterChipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  filterText: { color: colors.onSurfaceTertiary, fontWeight: "700", fontSize: 12 },
  filterTextActive: { color: colors.brandPrimary },
  count: { marginLeft: "auto", color: colors.onSurfaceTertiary, fontWeight: "800" },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  orderCol: { gap: 2 },
  orderBtn: { width: 36, height: 30, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm },
  orderText: { color: colors.onSurface, fontSize: 12 },
  rowIndex: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  rowText: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  actionCol: { flexDirection: "row", gap: 2 },
  actionBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  actionText: { color: colors.brandPrimary, fontSize: 18 },
  confirmRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  confirmText: { color: colors.warning, fontSize: 12, fontWeight: "700" },
  confirmYes: { backgroundColor: colors.error, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, minHeight: 32, justifyContent: "center" },
  confirmNo: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, minHeight: 32, justifyContent: "center" },
  confirmBtnText: { color: colors.onSurface, fontWeight: "800", fontSize: 12 },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.md },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: colors.muted, textAlign: "center", lineHeight: 20 },
  disabled: { opacity: 0.3 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  modalCard: { width: "100%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, minHeight: 80, borderWidth: 1, borderColor: colors.border, fontSize: 15, textAlignVertical: "top" },
  modalActions: { flexDirection: "row", gap: spacing.sm },
  primaryBtn: { flex: 1, backgroundColor: colors.brandPrimary, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontWeight: "800" },
  secondaryBtn: { flex: 1, backgroundColor: colors.surfaceTertiary, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.onSurface, fontWeight: "700" },
});
