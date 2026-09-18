import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Linking } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { SignCamera } from "@/src/components/SignCamera";
import { CameraOverlay, SignReviewBar } from "@/src/components/CameraOverlay";
import { useSignRecorder } from "@/src/useSignRecorder";

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called with the recognized sign sequence once the user confirms it. */
  onDone: (signs: string[]) => void;
  /** Called when the plan's recording limit auto-stopped the capture (free users → paywall). */
  onLimitReached?: () => void;
};

/** Full-screen sheet: front/back camera, start/stop video recording, careful analysis, review, send. */
export default function SignCaptureSheet({ visible, onClose, onDone, onLimitReached }: Props) {
  const insets = useSafeAreaInsets();
  const { t, lang } = useLang();
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [toast, setToastState] = useState<string | null>(null);
  const setToast = (m: string) => {
    setToastState(m);
    setTimeout(() => setToastState(null), 1800);
  };
  const rec = useSignRecorder(cameraRef, {
    language: lang,
    onSigns: (signs) => onDone(signs),
    onLimitReached,
    onNothingDetected: () => setToast(t.noSignDetected),
    onError: () => setToast(t.recognitionError),
  });

  useEffect(() => {
    if (!visible && rec.recording) rec.stop();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderCamera = () => {
    if (!camPerm?.granted) {
      const blocked = camPerm && !camPerm.canAskAgain;
      return (
        <View style={styles.permAsk} testID="sign-sheet-perm">
          <Text style={styles.permIcon}>📹</Text>
          <Text style={styles.permTitle}>{t.permCamera}</Text>
          <Text style={styles.permDesc}>{blocked ? t.cameraBlocked : t.permCameraDesc}</Text>
          <Pressable style={styles.primaryBtn} onPress={() => (blocked ? Linking.openSettings() : requestCamPerm())} testID="sign-sheet-request-camera">
            <Text style={styles.primaryBtnText}>{blocked ? t.openSettings : t.grantAccess}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.cameraWrap}>
        <SignCamera ref={cameraRef} recording={rec.recording} facing={rec.facing} mode={rec.cameraMode} />
        <CameraOverlay rec={rec} testPrefix="sign-sheet" />
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.lg }]} testID="sign-capture-sheet">
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.close} testID="sign-sheet-close">
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          <Text style={styles.title}>👐 {t.signComposeTitle}</Text>
          <View style={{ width: 44 }} />
        </View>
        {toast && (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}
        {renderCamera()}
        <SignReviewBar rec={rec} confirmLabel={`➤ ${t.sendSigns}`} testPrefix="sign-sheet-review" />
        <View style={styles.controls}>
          <Pressable
            style={[styles.recordBtn, rec.recording && styles.recordBtnActive, (!camPerm?.granted || rec.analyzing) && styles.disabled]}
            onPress={() => (rec.recording ? rec.stop() : rec.start())}
            disabled={!camPerm?.granted || rec.analyzing}
            testID="sign-sheet-record"
            accessibilityLabel={rec.recording ? t.tapToStop : t.tapToRecord}
          >
            <Text style={styles.recordBtnText}>{rec.recording ? "⏹" : "🎥"}</Text>
          </Pressable>
          <Text style={styles.hint}>{rec.recording ? t.tapToStop : t.tapToRecord}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeText: { color: colors.onSurface, fontSize: 22 },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  toast: { alignSelf: "center", backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  toastText: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  cameraWrap: { flex: 1, marginHorizontal: spacing.lg, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceSecondary },
  permAsk: { flex: 1, marginHorizontal: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  permIcon: { fontSize: 40 },
  permTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  permDesc: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: "center" },
  primaryBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill, minHeight: 44, justifyContent: "center" },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "700" },
  controls: { alignItems: "center", gap: spacing.xs, paddingTop: spacing.lg },
  recordBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  recordBtnActive: { backgroundColor: colors.error },
  recordBtnText: { fontSize: 32 },
  disabled: { opacity: 0.4 },
  hint: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "600" },
});
