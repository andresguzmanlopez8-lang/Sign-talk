import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import type { useSignRecorder } from "@/src/useSignRecorder";

type Recorder = ReturnType<typeof useSignRecorder>;

/** Overlays drawn on top of the camera: switch camera, REC timer, live detection / review chips, analysing state. */
export function CameraOverlay({ rec, testPrefix = "cam" }: { rec: Recorder; testPrefix?: string }) {
  const { t } = useLang();
  const warn = rec.recordLimit - rec.elapsed <= 5;
  return (
    <>
      <Pressable
        style={[styles.switchBtn, rec.recording && styles.disabled]}
        onPress={rec.toggleFacing}
        disabled={rec.recording}
        testID={`${testPrefix}-switch`}
        accessibilityLabel={t.switchCamera}
      >
        <Text style={styles.switchText}>🔄</Text>
      </Pressable>
      {rec.recording && (
        <View style={[styles.recBadge, warn && styles.recBadgeWarn]} testID={`${testPrefix}-timer`}>
          <View style={styles.recDot} />
          <Text style={styles.recText}>{t.recording} {rec.elapsed}s / {rec.recordLimit}s</Text>
        </View>
      )}
      {rec.recording && (
        <View style={styles.liveBox} testID={`${testPrefix}-live`}>
          {rec.cameraMode === "video" ? (
            <Text style={styles.liveLabel}>🎬 {t.recordingVideoHint}</Text>
          ) : (
            <>
              <Text style={styles.liveLabel}>{rec.liveSign?.sign ? `✋ ${t.detected}` : t.detecting}</Text>
              {rec.liveSign?.sign ? (
                <Text style={styles.liveSign}>
                  {rec.liveSign.sign} · {Math.round(rec.liveSign.confidence * 100)}%{rec.liveSign.motion === "dynamic" ? " · 🔁" : ""}
                </Text>
              ) : (
                <ActivityIndicator color={colors.brandPrimary} size="small" />
              )}
              {rec.detected.length > 0 && <Text style={styles.hint}>{t.tapChipToRemove}</Text>}
              {rec.detected.length > 0 && (
                <View style={styles.chips}>
                  {rec.detected.map((s, i) => (
                    <Pressable key={`${s}-${i}`} style={styles.chip} onPress={() => rec.removeDetected(i)} testID={`${testPrefix}-chip-${i}`}>
                      <Text style={styles.chipText}>{s} ✕</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      )}
      {rec.analyzing && (
        <View style={styles.analyzing} testID={`${testPrefix}-analyzing`}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
          <Text style={styles.analyzingText}>{t.analyzingCarefully}</Text>
        </View>
      )}
    </>
  );
}

/** Review bar shown after a video analysis: trim the detected sequence, then translate/send. */
export function SignReviewBar({ rec, confirmLabel, testPrefix = "review" }: { rec: Recorder; confirmLabel: string; testPrefix?: string }) {
  const { t } = useLang();
  if (!rec.pending) return null;
  return (
    <View style={styles.review} testID={`${testPrefix}-bar`}>
      <Text style={styles.reviewTitle}>✅ {t.reviewSigns} · {t.tapChipToRemove}</Text>
      <View style={styles.chips}>
        {rec.pending.map((s, i) => (
          <Pressable key={`${s}-${i}`} style={styles.chip} onPress={() => rec.removePending(i)} testID={`${testPrefix}-chip-${i}`}>
            <Text style={styles.chipText}>{s} ✕</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.reviewActions}>
        <Pressable style={styles.ghostBtn} onPress={rec.discardPending} testID={`${testPrefix}-discard`}>
          <Text style={styles.ghostText}>{t.cancel}</Text>
        </Pressable>
        <Pressable style={[styles.confirmBtn, rec.pending.length === 0 && styles.disabled]} onPress={rec.confirmPending} disabled={rec.pending.length === 0} testID={`${testPrefix}-confirm`}>
          <Text style={styles.confirmText}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  switchBtn: { position: "absolute", top: spacing.md, right: spacing.md, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  switchText: { fontSize: 20 },
  disabled: { opacity: 0.4 },
  recBadge: { position: "absolute", top: spacing.md, left: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(239,68,68,0.9)", paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  recBadgeWarn: { backgroundColor: "rgba(245,158,11,0.95)" },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  recText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  liveBox: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.md, backgroundColor: "rgba(13,14,18,0.8)", borderRadius: radius.md, padding: spacing.sm, gap: 4, borderWidth: 1, borderColor: colors.border },
  liveLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  liveSign: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  hint: { color: colors.onSurfaceTertiary, fontSize: 10, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  chip: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, minHeight: 28, justifyContent: "center" },
  chipText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 12 },
  analyzing: { position: "absolute", inset: 0, backgroundColor: "rgba(13,14,18,0.85)", alignItems: "center", justifyContent: "center", gap: spacing.md },
  analyzingText: { color: colors.onSurface, fontWeight: "800", fontSize: 15, textAlign: "center", paddingHorizontal: spacing.lg },
  review: { marginHorizontal: spacing.lg, marginTop: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.brandPrimary },
  reviewTitle: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  reviewActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  ghostBtn: { minHeight: 40, paddingHorizontal: spacing.md, justifyContent: "center" },
  ghostText: { color: colors.onSurfaceTertiary, fontWeight: "700" },
  confirmBtn: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, justifyContent: "center" },
  confirmText: { color: colors.onBrandPrimary, fontWeight: "800" },
});
