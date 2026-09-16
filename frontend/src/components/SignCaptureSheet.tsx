import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ActivityIndicator, Platform, Linking } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { usePremium } from "@/src/premium";
import { SignCamera } from "@/src/components/SignCamera";

const FRAME_INTERVAL_MS = 400; // 2.5 fps sampling
const BURST_SIZE = 4;
const MIN_CONFIDENCE = 0.5;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called with the recognized sign sequence when the user stops recording. */
  onDone: (signs: string[]) => void;
  /** Called when the plan's recording limit auto-stopped the capture (free users → paywall). */
  onLimitReached?: () => void;
};

/** Full-screen sheet: camera + live burst recognition, returns the detected sign sequence. */
export default function SignCaptureSheet({ visible, onClose, onDone, onLimitReached }: Props) {
  const insets = useSafeAreaInsets();
  const { t, lang } = useLang();
  const { status: premium } = usePremium();
  const recordLimit = premium.limits.sign_record_seconds;
  const [elapsed, setElapsed] = useState(0);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRef = useRef<(auto?: boolean) => void>(() => {});
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [recording, setRecording] = useState(false);
  const [liveSign, setLiveSign] = useState<{ sign: string | null; confidence: number; motion?: string } | null>(null);
  const [detected, setDetected] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const detectedRef = useRef<string[]>([]);
  const recordingRef = useRef(false);
  const frameBusyRef = useRef(false);
  const analyzeBusyRef = useRef(false);
  const bufferRef = useRef<string[]>([]);
  const frameTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyzeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopLoop = () => {
    recordingRef.current = false;
    if (frameTimer.current) clearInterval(frameTimer.current);
    if (analyzeTimer.current) clearInterval(analyzeTimer.current);
    if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    frameTimer.current = null;
    analyzeTimer.current = null;
    elapsedTimer.current = null;
    bufferRef.current = [];
  };

  useEffect(() => {
    if (!visible) {
      stopLoop();
      setRecording(false);
      setLiveSign(null);
      detectedRef.current = [];
      setDetected([]);
    }
    return stopLoop;
  }, [visible]);

  const captureFrame = async () => {
    if (!recordingRef.current || frameBusyRef.current || !cameraRef.current) return;
    if (bufferRef.current.length >= BURST_SIZE + 1) return;
    frameBusyRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.3, skipProcessing: true, shutterSound: false, base64: Platform.OS === "web" });
      if (!photo) return;
      let base64 = photo.base64 ?? null;
      if (Platform.OS !== "web") {
        const small = await ImageManipulator.manipulateAsync(photo.uri, [{ resize: { width: 384 } }], {
          compress: 0.55,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        });
        base64 = small.base64 ?? null;
      }
      if (base64 && recordingRef.current) bufferRef.current.push(base64);
    } catch (e) {
      console.warn("frame", e);
    } finally {
      frameBusyRef.current = false;
    }
  };

  const analyzeBurst = async () => {
    if (!recordingRef.current || analyzeBusyRef.current) return;
    if (bufferRef.current.length < Math.min(3, BURST_SIZE)) return;
    analyzeBusyRef.current = true;
    const frames = bufferRef.current.slice(0, BURST_SIZE);
    bufferRef.current = [];
    try {
      const res = await api.signFrame(frames, lang, detectedRef.current);
      if (!recordingRef.current) return;
      setLiveSign(res);
      const last = detectedRef.current[detectedRef.current.length - 1];
      if (res.sign && res.confidence >= MIN_CONFIDENCE && res.sign.toLowerCase() !== last?.toLowerCase()) {
        detectedRef.current = [...detectedRef.current, res.sign];
        setDetected(detectedRef.current);
        Haptics.selectionAsync().catch(() => {});
      }
    } catch (e) {
      console.warn("burst", e);
    } finally {
      analyzeBusyRef.current = false;
    }
  };

  const start = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    detectedRef.current = [];
    setDetected([]);
    setLiveSign(null);
    recordingRef.current = true;
    setRecording(true);
    bufferRef.current = [];
    frameTimer.current = setInterval(captureFrame, FRAME_INTERVAL_MS);
    analyzeTimer.current = setInterval(analyzeBurst, 300);
    setElapsed(0);
    const startedAt = Date.now();
    elapsedTimer.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(s);
      if (s >= recordLimit && recordingRef.current) stopRef.current(true);
    }, 500);
  };

  const stop = (auto = false) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    stopLoop();
    setRecording(false);
    setLiveSign(null);
    const signs = detectedRef.current;
    if (signs.length === 0) {
      setToast(t.noSignDetected);
      setTimeout(() => setToast(null), 1800);
      if (auto) onLimitReached?.();
      return;
    }
    onDone(signs);
    if (auto) onLimitReached?.();
  };
  stopRef.current = stop;

  const removeDetected = (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    detectedRef.current = detectedRef.current.filter((_, i) => i !== index);
    setDetected(detectedRef.current);
  };

  const renderCamera = () => {
    if (!camPerm?.granted) {
      const blocked = camPerm && !camPerm.canAskAgain;
      return (
        <View style={styles.permAsk} testID="sign-sheet-perm">
          <Text style={styles.permIcon}>📹</Text>
          <Text style={styles.permTitle}>{t.permCamera}</Text>
          <Text style={styles.permDesc}>{blocked ? t.cameraBlocked : t.permCameraDesc}</Text>
          <Pressable
            style={styles.primaryBtn}
            onPress={() => (blocked ? Linking.openSettings() : requestCamPerm())}
            testID="sign-sheet-request-camera"
          >
            <Text style={styles.primaryBtnText}>{blocked ? t.openSettings : t.grantAccess}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.cameraWrap}>
        <SignCamera ref={cameraRef} recording={recording} />
        {recording && (
          <View style={[styles.recBadge, recordLimit - elapsed <= 5 && styles.recBadgeWarn]} testID="sign-sheet-timer">
            <View style={styles.recDot} />
            <Text style={styles.recText}>{t.recording} {elapsed}s / {recordLimit}s</Text>
          </View>
        )}
        {recording && (
          <View style={styles.liveBox} testID="sign-sheet-live">
            <Text style={styles.liveLabel}>{liveSign?.sign ? `✋ ${t.detected}` : t.detecting}</Text>
            {liveSign?.sign ? (
              <Text style={styles.liveSign}>
                {liveSign.sign} · {Math.round(liveSign.confidence * 100)}%{liveSign.motion === "dynamic" ? " · 🔁" : ""}
              </Text>
            ) : (
              <ActivityIndicator color={colors.brandPrimary} size="small" />
            )}
            {detected.length > 0 && <Text style={styles.seqHint}>{t.tapChipToRemove}</Text>}
            {detected.length > 0 && (
              <View style={styles.seqRow}>
                {detected.map((s, i) => (
                  <Pressable key={`${s}-${i}`} style={styles.seqChip} onPress={() => removeDetected(i)} testID={`sign-sheet-chip-${i}`}>
                    <Text style={styles.seqText}>{s} ✕</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
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
        <View style={styles.controls}>
          <Pressable
            style={[styles.recordBtn, recording && styles.recordBtnActive, !camPerm?.granted && styles.disabled]}
            onPress={() => (recording ? stop() : start())}
            disabled={!camPerm?.granted}
            testID="sign-sheet-record"
            accessibilityLabel={recording ? t.tapToStop : t.tapToRecord}
          >
            <Text style={styles.recordBtnText}>{recording ? "⏹" : "🎥"}</Text>
          </Pressable>
          <Text style={styles.hint}>{recording ? `${t.tapToStop} · ${t.sendSigns}` : t.tapToRecord}</Text>
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
  recBadge: { position: "absolute", top: spacing.md, left: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(239,68,68,0.9)", paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  recBadgeWarn: { backgroundColor: "rgba(245,158,11,0.95)" },
  recText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  liveBox: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.md, backgroundColor: "rgba(13,14,18,0.8)", borderRadius: radius.md, padding: spacing.sm, gap: 4, borderWidth: 1, borderColor: colors.border },
  liveLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  liveSign: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  seqRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  seqChip: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, minHeight: 28, justifyContent: "center" },
  seqText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 12 },
  seqHint: { color: colors.onSurfaceTertiary, fontSize: 10, marginTop: 2 },
  controls: { alignItems: "center", gap: spacing.xs, paddingTop: spacing.lg },
  recordBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  recordBtnActive: { backgroundColor: colors.error },
  recordBtnText: { fontSize: 32 },
  disabled: { opacity: 0.4 },
  hint: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "600" },
});
