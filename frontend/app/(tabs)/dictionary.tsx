import { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Modal,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";

const LETTERS_ES = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","Ñ","O","P","Q","R","S","T","U","V","W","X","Y","Z"];
const LETTERS_EN = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"];

export default function Dictionary() {
  const insets = useSafeAreaInsets();
  const { t, lang } = useLang();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | "letter" | "word">("all");
  const [selected, setSelected] = useState<any | null>(null);

  const letters = lang === "es" ? LETTERS_ES : LETTERS_EN;

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.dictionary({ language: lang });
      setItems(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [lang]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (kind !== "all" && it.kind !== kind) return false;
      if (letter && !it.label.toUpperCase().startsWith(letter)) return false;
      if (q && !it.label.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [items, q, letter, kind]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title} testID="dict-title">{t.dictionary}</Text>
        <View style={styles.langPill}>
          <Text style={styles.langPillText}>{lang === "es" ? "🇲🇽 LSM" : "🇺🇸 ASL"}</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder={t.searchSigns}
          placeholderTextColor={colors.muted}
          testID="dict-search"
        />
      </View>

      <View style={styles.kindRow}>
        {(["all", "letter", "word"] as const).map((k) => (
          <Pressable
            key={k}
            style={[styles.kindChip, kind === k && styles.kindChipActive]}
            onPress={() => setKind(k)}
            testID={`kind-${k}`}
          >
            <Text style={[styles.kindText, kind === k && styles.kindTextActive]}>
              {k === "all" ? t.all : k === "letter" ? t.letters : t.words}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.letterScroll}
        contentContainerStyle={styles.letterRow}
      >
        <Pressable
          style={[styles.letterChip, letter === null && styles.letterChipActive]}
          onPress={() => setLetter(null)}
          testID="letter-all"
        >
          <Text style={[styles.letterText, letter === null && styles.letterTextActive]}>All</Text>
        </Pressable>
        {letters.map((l) => (
          <Pressable
            key={l}
            style={[styles.letterChip, letter === l && styles.letterChipActive]}
            onPress={() => setLetter(l)}
            testID={`letter-${l}`}
          >
            <Text style={[styles.letterText, letter === l && styles.letterTextActive]}>{l}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md }}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => setSelected(item)} testID={`card-${item.id}`}>
              <View style={styles.cardImg}>
                <Image
                  source={{ uri: item.gif_url || item.image_url }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                />
              </View>
              <Text style={styles.cardLabel}>{item.label}</Text>
              <Text style={styles.cardKind}>{item.kind === "letter" ? "•" : "★"}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyText}>No results</Text>
            </View>
          }
        />
      )}

      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)} transparent>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Pressable onPress={() => setSelected(null)} style={styles.modalClose} testID="modal-close">
              <Text style={styles.modalCloseText}>✕</Text>
            </Pressable>
            {selected && (
              <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
                <View style={styles.detailImg}>
                  <Image
                    source={{ uri: selected.gif_url || selected.image_url }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit="contain"
                  />
                </View>
                <Text style={styles.detailLabel}>{selected.label}</Text>
                <Text style={styles.detailKind}>{selected.kind === "letter" ? "Letra / Letter" : "Palabra / Word"} · {selected.language.toUpperCase()}</Text>
                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxTitle}>Descripción</Text>
                  <Text style={styles.detailDesc}>{selected.description}</Text>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  langPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  langPillText: { color: colors.onSurface, fontWeight: "700", fontSize: 12 },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  search: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    color: colors.onSurface,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kindRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  kindChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  kindChipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  kindText: { color: colors.onSurfaceTertiary, fontWeight: "700", fontSize: 12 },
  kindTextActive: { color: colors.brandPrimary },
  letterScroll: { flexGrow: 0, maxHeight: 56, paddingVertical: spacing.sm },
  letterRow: { gap: spacing.xs, paddingHorizontal: spacing.lg, alignItems: "center" },
  letterChip: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, flexShrink: 0 },
  letterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  letterText: { color: colors.onSurfaceTertiary, fontWeight: "800", fontSize: 12 },
  letterTextActive: { color: colors.onBrandPrimary },
  grid: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  cardImg: { aspectRatio: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, overflow: "hidden", marginBottom: spacing.sm },
  cardLabel: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  cardKind: { position: "absolute", top: spacing.sm, right: spacing.sm, color: colors.brandPrimary, fontSize: 10 },
  empty: { alignItems: "center", padding: spacing.xxl },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { color: colors.muted },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "88%" },
  modalClose: { alignSelf: "flex-end", width: 48, height: 48, alignItems: "center", justifyContent: "center", margin: spacing.sm },
  modalCloseText: { color: colors.onSurface, fontSize: 22 },
  detailImg: { width: "100%", aspectRatio: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, overflow: "hidden", marginBottom: spacing.lg },
  detailLabel: { color: colors.onSurface, fontSize: 32, fontWeight: "800" },
  detailKind: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 4, textTransform: "uppercase", letterSpacing: 1 },
  detailBox: { marginTop: spacing.lg, backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  detailBoxTitle: { color: colors.brandPrimary, fontWeight: "800", fontSize: 12, textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm },
  detailDesc: { color: colors.onSurface, fontSize: 15, lineHeight: 22 },
});
