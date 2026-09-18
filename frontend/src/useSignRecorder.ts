import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { CameraView } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { usePremium } from "@/src/premium";

export type LiveSign = { sign: string | null; confidence: number; motion?: string } | null;
export type Facing = "front" | "back";

/** Native: record a real video (start/stop) and analyse the whole clip on the server. Web: photo-burst fallback. */
export const USE_VIDEO_RECORDING = Platform.OS !== "web";

const FRAME_INTERVAL_MS = 400; // burst sampling: 2.5 fps
const BURST_SIZE = 4;
const MIN_CONFIDENCE = 0.5;

type Options = {
  language: "es" | "en";
  /** Final ordered sign sequence (after the user reviewed it on native, or live-detected on web). */
  onSigns: (signs: string[]) => Promise<void> | void;
  /** Recording was auto-stopped by the plan limit. */
  onLimitReached?: () => void;
  onNothingDetected?: () => void;
  onError?: (message?: string) => void;
};

/**
 * Shared sign-capture engine for the Translator and the Chat sheet.
 *  - front/back camera switch
 *  - start/stop recording with the plan's time limit
 *  - "Analizando señas cuidadosamente…" phase (native: full video → server frames → sequence)
 *  - review chips (`pending`) the user can trim before translating/sending
 */
export function useSignRecorder(cameraRef: React.RefObject<CameraView | null>, opts: Options) {
  const { status } = usePremium();
  const recordLimit = status.limits.sign_record_seconds;
  const [facing, setFacing] = useState<Facing>("front");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [liveSign, setLiveSign] = useState<LiveSign>(null);
  const [detected, setDetected] = useState<string[]>([]);
  const [pending, setPending] = useState<string[] | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const recordingRef = useRef(false);
  const autoStoppedRef = useRef(false);
  const detectedRef = useRef<string[]>([]);
  const bufferRef = useRef<string[]>([]);
  const frameBusyRef = useRef(false);
  const analyzeBusyRef = useRef(false);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearInterval);
    timers.current = [];
    bufferRef.current = [];
  };

  useEffect(() => () => clearTimers(), []);

  const toggleFacing = () => {
    if (recordingRef.current) return;
    Haptics.selectionAsync().catch(() => {});
    setFacing((f) => (f === "front" ? "back" : "front"));
  };

  // ---- web fallback: photo bursts analysed live ----
  const captureFrame = async () => {
    if (!recordingRef.current || frameBusyRef.current || !cameraRef.current) return;
    if (bufferRef.current.length >= BURST_SIZE + 1) return;
    frameBusyRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.3, skipProcessing: true, shutterSound: false, base64: Platform.OS === "web" });
      if (!photo) return;
      let base64 = photo.base64 ?? null;
      if (Platform.OS !== "web") {
        const small = await ImageManipulator.manipulateAsync(photo.uri, [{ resize: { width: 384 } }], { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG, base64: true });
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
    if (!recordingRef.current || analyzeBusyRef.current || bufferRef.current.length < 3) return;
    analyzeBusyRef.current = true;
    const frames = bufferRef.current.slice(0, BURST_SIZE);
    bufferRef.current = [];
    try {
      const res = await api.signFrame(frames, optsRef.current.language, detectedRef.current);
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

  const finishRecordingState = () => {
    recordingRef.current = false;
    clearTimers();
    setRecording(false);
    setLiveSign(null);
  };

  const start = useCallback(async () => {
    if (recordingRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    detectedRef.current = [];
    setDetected([]);
    setPending(null);
    setLiveSign(null);
    autoStoppedRef.current = false;
    recordingRef.current = true;
    setRecording(true);
    setElapsed(0);
    const startedAt = Date.now();
    timers.current.push(
      setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        setElapsed(s);
        if (s >= recordLimit && recordingRef.current) {
          autoStoppedRef.current = true;
          stopRef.current();
        }
      }, 500)
    );

    if (!USE_VIDEO_RECORDING) {
      timers.current.push(setInterval(captureFrame, FRAME_INTERVAL_MS), setInterval(analyzeBurst, 300));
      return;
    }
    // Native: real video file; resolves when stopRecording() is called (or maxDuration hits).
    try {
      const video = await cameraRef.current?.recordAsync({ maxDuration: recordLimit + 1 });
      const wasAuto = autoStoppedRef.current;
      finishRecordingState();
      if (!video?.uri) return;
      setAnalyzing(true);
      try {
        const res = await api.signVideo(video.uri, optsRef.current.language);
        if (!res.signs?.length) optsRef.current.onNothingDetected?.();
        else setPending(res.signs);
      } catch (e: any) {
        console.warn("sign video", e);
        optsRef.current.onError?.(e?.message);
      } finally {
        setAnalyzing(false);
        if (wasAuto) optsRef.current.onLimitReached?.();
      }
    } catch (e) {
      console.warn("recordAsync", e);
      finishRecordingState();
      optsRef.current.onError?.();
    }
  }, [recordLimit]);

  const stop = useCallback(async () => {
    if (!recordingRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (USE_VIDEO_RECORDING) {
      cameraRef.current?.stopRecording(); // → recordAsync resolves and continues in start()
      return;
    }
    const wasAuto = autoStoppedRef.current;
    finishRecordingState();
    const signs = detectedRef.current;
    if (signs.length === 0) optsRef.current.onNothingDetected?.();
    else await optsRef.current.onSigns(signs);
    if (wasAuto) optsRef.current.onLimitReached?.();
  }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const removeDetected = (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    detectedRef.current = detectedRef.current.filter((_, i) => i !== index);
    setDetected(detectedRef.current);
  };

  const removePending = (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPending((p) => (p ? p.filter((_, i) => i !== index) : p));
  };

  const confirmPending = async () => {
    const signs = pending ?? [];
    setPending(null);
    if (signs.length) await optsRef.current.onSigns(signs);
  };

  const discardPending = () => setPending(null);

  return {
    facing, toggleFacing, recording, elapsed, recordLimit, analyzing,
    liveSign, detected, removeDetected,
    pending, removePending, confirmPending, discardPending,
    start, stop, cameraMode: (USE_VIDEO_RECORDING ? "video" : "picture") as "video" | "picture",
  };
}
