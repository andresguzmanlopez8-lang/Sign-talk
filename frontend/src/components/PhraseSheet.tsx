import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, FlatList, ActivityIndicator, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";

export type Phrase = { id: string; category: string; text: string; category_label: string; category_emoji: string };
type Category = { id: string; label: string; emoji: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
  onFavorite: (text: string) => void;
  isFavorite: (text: string) => boolean;
};

export default function PhraseSheet({ visible, onClose, onSend, onFavorite, isFavorite }: Props) {
  const insets = useSafeAreaInsets();
  const { t, lang } = useLang();
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQ("");
    setCat(null);
    setLoading(true);
    api
      .phrases(lang)
      .then((res) => {
        setPhrases(res.items);
        setCategories(res.categories);
      })
      .catch((e) => console.warn(e))
      .finally(() => setLoading(false));
  }, [visible, lang]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return phrases.filter((p) => (!cat || p.category === cat) && (!s || p.text.toLowerCase().includes(s)));
  }, [phrases, q, cat]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.bg}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="phrase-sheet">
          <View style={styles.header}>
            <Text style={styles.title}>💬 {t.phrasesTitle}</Text>
            <Pressable onPress={onClose} style={styles.close} testID="phrase-sheet-close">
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.search}
            value={q}
            onChangeText={setQ}
            placeholder={t.searchPhrases}
            placeholderTextColor={colors.muted}
            testID="phrase-search"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catRow}>
            <Pressable style={[styles.catChip, cat === null && styles.catChipActive]} onPress={() => setCat(null)} testID="phrase-cat-all">
              <Text style={[styles.catText, cat === null && styles.catTextActive]}>{t.all}</Text>
            </Pressable>
            {categories.map((c) => (
              <Pressable key={c.id} style={[styles.catChip, cat === c.id && styles.catChipActive]} onPress={() => setCat(c.id)} testID={`phrase-cat-${c.id}`}>
                <Text style={[styles.catText, cat === c.id && styles.catTextActive]}>{c.emoji} {c.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {loading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ margin: spacing.xl }} />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(p) => p.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: spacing.lg, gap: spacing.sm }}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <Pressable
                    style={styles.phraseBtn}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onSend(item.text);
                      onClose();
                    }}
                    testID={`phrase-${item.id}`}
                  >
                    <Text style={styles.phraseCat}>{item.category_emoji} {item.category_label}</Text>
                    <Text style={styles.phraseText}>{item.text}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.starBtn}
                    onPress={() => onFavorite(item.text)}
                    testID={`phrase-fav-${item.id}`}
                    accessibilityLabel={t.saveFavorite}
                  >
                    <Text style={styles.starText}>{isFavorite(item.text) ? "⭐" : "☆"}</Text>
                  </Pressable>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.empty}>🔍</Text>}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "85%", paddingHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeText: { color: colors.onSurface, fontSize: 20 },
  search: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, color: colors.onSurface, height: 44, borderWidth: 1, borderColor: colors.border },
  catScroll: { flexGrow: 0, marginVertical: spacing.sm },
  catRow: { gap: spacing.sm, alignItems: "center" },
  catChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, minHeight: 36, justifyContent: "center" },
  catChipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  catText: { color: colors.onSurfaceTertiary, fontWeight: "700", fontSize: 12 },
  catTextActive: { color: colors.brandPrimary },
  row: { flexDirection: "row", alignItems: "stretch", gap: spacing.sm },
  phraseBtn: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, minHeight: 56, justifyContent: "center" },
  phraseCat: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", marginBottom: 2 },
  phraseText: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  starBtn: { width: 48, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  starText: { fontSize: 20, color: colors.brandPrimary },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.lg, fontSize: 28 },
});
