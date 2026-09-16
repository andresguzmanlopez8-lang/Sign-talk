import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { usePremium } from "@/src/premium";

export type Avatar = { id: string; gender: "male" | "female"; name: string; style: string; image_url: string; locked: boolean };

type Props = {
  selectedId: string | null;
  onSelect: (avatar: Avatar) => Promise<void> | void;
  compact?: boolean;
};

/** Avatar gallery with male/female filter. Free plan: 1 male + 1 female; locked avatars open the paywall. */
export default function AvatarGallery({ selectedId, onSelect, compact }: Props) {
  const { t } = useLang();
  const router = useRouter();
  const { isPremium } = usePremium();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [gender, setGender] = useState<"all" | "male" | "female">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api.avatars().then((r) => setAvatars(r.items)).catch((e) => console.warn(e)).finally(() => setLoading(false));
  }, [isPremium]);

  const visible = avatars.filter((a) => gender === "all" || a.gender === gender);

  const pick = async (a: Avatar) => {
    Haptics.selectionAsync().catch(() => {});
    if (a.locked && !isPremium) {
      router.push({ pathname: "/paywall", params: { reason: "avatar" } });
      return;
    }
    setSaving(a.id);
    try {
      await onSelect(a);
    } finally {
      setSaving(null);
    }
  };

  return (
    <View style={styles.wrap} testID="avatar-gallery">
      <View style={styles.filters}>
        {(["all", "male", "female"] as const).map((g) => (
          <Pressable key={g} style={[styles.chip, gender === g && styles.chipActive]} onPress={() => setGender(g)} testID={`avatar-filter-${g}`}>
            <Text style={[styles.chipText, gender === g && styles.chipTextActive]}>
              {g === "all" ? t.all : g === "male" ? `👨 ${t.male}` : `👩 ${t.female}`}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ margin: spacing.lg }} />
      ) : (
        <View style={styles.grid}>
          {visible.map((a) => {
            const active = a.id === selectedId;
            const locked = a.locked && !isPremium;
            return (
              <Pressable key={a.id} style={[styles.card, compact && styles.cardCompact, active && styles.cardActive, locked && styles.cardLocked]} onPress={() => pick(a)} testID={`avatar-${a.id}`}>
                <Image source={{ uri: a.image_url }} style={[styles.img, compact && styles.imgCompact, locked && styles.imgLocked]} contentFit="cover" />
                <Text style={styles.name}>{a.name}</Text>
                <Text style={styles.style}>{locked ? `👑 ${t.premiumOnly}` : a.style}</Text>
                {locked && <Text style={styles.lock} testID={`avatar-locked-${a.id}`}>🔒</Text>}
                {active && <Text style={styles.check} testID={`avatar-selected-${a.id}`}>✓</Text>}
                {saving === a.id && <ActivityIndicator style={styles.saving} color={colors.brandPrimary} size="small" />}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  filters: { flexDirection: "row", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, minHeight: 36, justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceTertiary, fontWeight: "700", fontSize: 12 },
  chipTextActive: { color: colors.brandPrimary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: { width: "31%", flexGrow: 1, minWidth: 96, alignItems: "center", padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.border, gap: 2 },
  cardCompact: { minWidth: 80 },
  cardActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  cardLocked: { borderStyle: "dashed", opacity: 0.85 },
  img: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceTertiary },
  imgLocked: { opacity: 0.45 },
  lock: { position: "absolute", top: 6, right: 8, fontSize: 16 },
  imgCompact: { width: 56, height: 56, borderRadius: 28 },
  name: { color: colors.onSurface, fontWeight: "800", fontSize: 13, marginTop: 4 },
  style: { color: colors.onSurfaceTertiary, fontSize: 11 },
  check: { position: "absolute", top: 6, right: 8, color: colors.brandPrimary, fontWeight: "900", fontSize: 16 },
  saving: { position: "absolute", top: 6, left: 8 },
});
