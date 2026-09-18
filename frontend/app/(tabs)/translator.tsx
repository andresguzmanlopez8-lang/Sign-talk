import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { usePremium } from "@/src/premium";
import { useSignRecorder } from "@/src/useSignRecorder";
import { CameraOverlay, SignReviewBar } from "@/src/components/CameraOverlay";
import { exportChatPdf } from "@/src/exportChat";
import ContactPicker from "@/src/components/ContactPicker";
import { SignCamera } from "@/src/components/SignCamera";
import BubbleVideo from "@/src/components/BubbleVideo";
import PhraseSheet from "@/src/components/PhraseSheet";
import StreakBanner from "@/src/components/StreakBanner";

type Favorite = { id: string; text: string; language: "es" | "en" };

type Msg = {
  id: string;
  direction: "sign_to_text" | "text_to_sign" | "voice_to_text";
  language: "es" | "en";
  original_text?: string | null;
  translated_text: string;
  sign_sequence?: string[] | null;
  audio_url?: string | null;
  video_url?: string | null;
  video_credits?: string[] | null;
  avatar_id?: string | null;
  created_at: string;
};

type Mode = "sign" | "voice";

export default function Translator() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, lang, setLang } = useLang();
  const { isPremium, notifyMessageSent, refresh: refreshPremium } = usePremium();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [mode, setMode] = useState<Mode>("sign");
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [avatarVideo, setAvatarVideo] = useState<string | null>(null);
  const [avatarCredits, setAvatarCredits] = useState<string[] | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [shareText, setShareText] = useState<string | null>(null);
  const [phrasesOpen, setPhrasesOpen] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const recorder = useSignRecorder(cameraRef, {
    language: lang,
    onSigns: (signs) => translateSigns(signs),
    onLimitReached: () => {
      if (!isPremium) router.push({ pathname: "/paywall", params: { reason: "limit" } });
    },
    onNothingDetected: () => showToast(t.noSignDetected),
    onError: () => showToast(t.recognitionError),
  });
  const recordingSign = recorder.recording;

  const scrollRef = useRef<FlatList<Msg>>(null);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayerRef = useRef<any>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    AudioModule.requestRecordingPermissionsAsync().catch(() => {});
    loadMessages();
    refreshPremium();
  }, []);

  useFocusEffect(
    useCallback(() => {
      api.favorites(lang).then(setFavorites).catch(() => {});
    }, [lang])
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const saveFavorite = async (text: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const fav = await api.addFavorite(text, lang);
      setFavorites((prev) => (prev.some((f) => f.id === fav.id) ? prev : [...prev, fav]));
      showToast(`⭐ ${t.savedFavorite}`);
    } catch (e) {
      console.warn(e);
    }
  };

  const removeFavorite = async (fav: Favorite) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFavorites((prev) => prev.filter((f) => f.id !== fav.id));
    try {
      await api.deleteFavorite(fav.id);
    } catch (e) {
      console.warn(e);
    }
  };

  const sendFavorite = async (fav: Favorite) => sendPhrase(fav.text);

  const sendPhrase = async (phrase: string) => {
    if (loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMode("voice");
    setLoading(true);
    try {
      const msg = await api.textToSign(phrase, lang);
      setMessages((prev) => [...prev, msg]);
      setAvatarVideo(msg.video_url ?? null);
      setAvatarCredits(msg.video_credits ?? null);
      notifyMessageSent();
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      scrollToEnd();
    }
  };

  const exportPdf = async () => {
    if (messages.length === 0) {
      showToast(t.exportEmpty);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExporting(true);
    try {
      let userName: string | null = null;
      try {
        userName = (await api.me())?.name ?? null;
      } catch {}
      await exportChatPdf(messages, { title: t.exportTitle, userName, lang });
    } catch (e) {
      console.warn("export", e);
    } finally {
      setExporting(false);
    }
  };

  const loadMessages = async () => {
    try {
      const list = await api.messages();
      setMessages(list);
    } catch {}
  };

  const translateSigns = async (signs: string[]) => {
    setLoading(true);
    try {
      const msg = await api.signToText(lang, signs);
      setMessages((prev) => [...prev, msg]);
      notifyMessageSent();
      try {
        const tts = await api.tts(msg.translated_text, lang === "es" ? "nova" : "alloy");
        playAudio(`${api.base}${tts.url}`);
      } catch {}
    } catch (e) {
      console.warn(e);
      showToast(t.recognitionError);
    } finally {
      setLoading(false);
      scrollToEnd();
    }
  };

  const startRecordVoice = async () => {
    try {
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setRecordingVoice(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      console.warn("start rec", e);
    }
  };

  const stopRecordVoice = async () => {
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      setRecordingVoice(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (uri) {
        setLoading(true);
        const msg = await api.voiceToText(uri, lang);
        setMessages((prev) => [...prev, msg]);
        setAvatarVideo(msg.video_url ?? null);
      setAvatarCredits(msg.video_credits ?? null);
        notifyMessageSent();
      }
    } catch (e) {
      console.warn("stop rec", e);
    } finally {
      setLoading(false);
      scrollToEnd();
    }
  };

  const sendText = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const msg = await api.textToSign(text.trim(), lang);
      setMessages((prev) => [...prev, msg]);
      setAvatarVideo(msg.video_url ?? null);
      setAvatarCredits(msg.video_credits ?? null);
      setText("");
      notifyMessageSent();
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      scrollToEnd();
    }
  };

  const clearChat = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await api.clearMessages();
    setMessages([]);
    setAvatarVideo(null);
  };

  const scrollToEnd = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const playAudio = useCallback(async (url: string) => {
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      if (audioPlayerRef.current) {
        audioPlayerRef.current.remove?.();
      }
      const { createAudioPlayer } = await import("expo-audio");
      const player = createAudioPlayer({ uri: url });
      audioPlayerRef.current = player;
      player.play();
    } catch (e) {
      console.warn("play err", e);
    }
  }, []);

  const renderMessage = ({ item }: { item: Msg }) => {
    const isSign = item.direction === "sign_to_text";
    return (
      <View style={[styles.bubble, isSign ? styles.bubbleLeft : styles.bubbleRight]} testID={`msg-${item.id}`}>
        <Text style={styles.bubbleLabel}>
          {isSign ? "👐 → 💬" : "🎤 → 👐"}
        </Text>
        {item.original_text && item.original_text !== item.translated_text && (
          <Text style={styles.bubbleMeta}>{item.original_text}</Text>
        )}
        {item.video_url && <BubbleVideo uri={`${api.base}${item.video_url}`} credits={item.video_credits} testID={`video-${item.id}`} />}
        <Text style={styles.bubbleText}>{item.translated_text}</Text>
        <View style={styles.bubbleActions}>
          {!isSign && item.video_url && (
            <Pressable
              onPress={() => {
                setMode("voice");
                setAvatarVideo(item.video_url!);
                setAvatarCredits(item.video_credits ?? null);
              }}
              style={styles.replayBtn}
              testID={`replay-${item.id}`}
            >
              <Text style={styles.replayText}>▶ {t.tapToSign}</Text>
            </Pressable>
          )}
          {isSign && (
            <Pressable
              onPress={async () => {
                const tts = await api.tts(item.translated_text, lang === "es" ? "nova" : "alloy");
                playAudio(`${api.base}${tts.url}`);
              }}
              style={styles.replayBtn}
              testID={`play-${item.id}`}
            >
              <Text style={styles.replayText}>🔊</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => saveFavorite(item.translated_text)}
            style={styles.replayBtn}
            testID={`fav-${item.id}`}
            accessibilityLabel={t.saveFavorite}
          >
            <Text style={styles.replayText}>{isFav(item.translated_text) ? "⭐" : "☆"}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShareText(item.translated_text);
            }}
            style={styles.replayBtn}
            testID={`share-${item.id}`}
            accessibilityLabel={t.shareMessage}
          >
            <Text style={styles.replayText}>📤</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const isFav = (text: string) => favorites.some((f) => f.text === text);


  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title} testID="translator-title">{t.translator}</Text>
          <View style={styles.headerRight}>
            <Pressable
              style={styles.langPill}
              onPress={() => setLang(lang === "es" ? "en" : "es")}
              testID="lang-switch"
            >
              <Text style={styles.langPillText}>{lang === "es" ? "🇲🇽 LSM" : "🇺🇸 ASL"}</Text>
            </Pressable>
            {messages.length > 0 && (
              <Pressable onPress={exportPdf} style={styles.clearBtn} testID="export-pdf" disabled={exporting} accessibilityLabel={t.exportPdf}>
                {exporting ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={styles.clearText}>📄</Text>}
              </Pressable>
            )}
            {messages.length > 0 && (
              <Pressable onPress={clearChat} style={styles.clearBtn} testID="clear-chat">
                <Text style={styles.clearText}>🗑️</Text>
              </Pressable>
            )}
          </View>
        </View>

        {toast && (
          <View style={styles.toast} testID="toast">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}

        <StreakBanner />

        {/* Top: Camera or Avatar */}
        <View style={styles.top}>
          {mode === "sign" ? (
            camPerm?.granted ? (
              <View style={styles.cameraWrap}>
                <SignCamera ref={cameraRef} recording={recordingSign} facing={recorder.facing} mode={recorder.cameraMode} />
                <LinearGradient
                  colors={["transparent", "rgba(13,14,18,0.9)"]}
                  style={styles.scrim}
                  pointerEvents="none"
                />
                <CameraOverlay rec={recorder} testPrefix="translator-cam" />
              </View>
            ) : (
              <View style={styles.permAsk}>
                <Text style={styles.permIcon}>📹</Text>
                <Text style={styles.permTitle}>{t.permCamera}</Text>
                <Pressable style={styles.primaryBtn} onPress={requestCamPerm} testID="request-camera">
                  <Text style={styles.primaryBtnText}>{t.grantAccess}</Text>
                </Pressable>
              </View>
            )
          ) : (
            <View style={styles.avatarWrap} testID="avatar-view">
              {avatarVideo ? (
                <>
                  <BubbleVideo key={avatarVideo} uri={`${api.base}${avatarVideo}`} style={styles.avatarVideo} testID="avatar-video" />
                  {!!avatarCredits?.length && (
                    <Text style={styles.avatarCredits} testID="avatar-video-credits" numberOfLines={1}>🎥 {avatarCredits.join(" · ")}</Text>
                  )}
                </>
              ) : (
                <View style={styles.avatarEmpty}>
                  <Text style={styles.avatarEmptyIcon}>🧍</Text>
                  <Text style={styles.avatarEmptyText}>{t.signAvatar}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Mode Switch */}
        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeBtn, mode === "sign" && styles.modeBtnActive]}
            onPress={() => setMode("sign")}
            testID="mode-sign"
          >
            <Text style={[styles.modeText, mode === "sign" && styles.modeTextActive]}>👐 Señas → Texto</Text>
          </Pressable>
          <Pressable
            style={[styles.modeBtn, mode === "voice" && styles.modeBtnActive]}
            onPress={() => setMode("voice")}
            testID="mode-voice"
          >
            <Text style={[styles.modeText, mode === "voice" && styles.modeTextActive]}>💬 → Señas</Text>
          </Pressable>
        </View>

        {mode === "sign" && <SignReviewBar rec={recorder} confirmLabel={`✓ ${t.translateSigns}`} testPrefix="translator-review" />}

        {/* Chat */}
        <FlatList
          ref={scrollRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.chat}
          onContentSizeChange={scrollToEnd}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatText}>
                {mode === "sign" ? t.startSigning : t.typeMessage}
              </Text>
            </View>
          }
        />

        {loading && mode === "voice" && (
          <View style={styles.renderingBox} testID="rendering-avatar">
            <ActivityIndicator color={colors.brandPrimary} size="small" />
            <Text style={styles.renderingText}>🧍 {t.renderingAvatar}</Text>
          </View>
        )}

        {/* Bottom controls */}
        <View style={[styles.controls, { paddingBottom: spacing.md }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.favScroll}
            contentContainerStyle={styles.favRow}
            keyboardShouldPersistTaps="handled"
            testID="favorites-row"
          >
            <Pressable style={styles.phrasesChip} onPress={() => setPhrasesOpen(true)} testID="open-phrases">
              <Text style={styles.phrasesChipText}>💬 {t.phrases}</Text>
            </Pressable>
            <Text style={styles.favStar}>⭐</Text>
            {favorites.length === 0 ? (
              <Text style={styles.favEmpty}>{t.noFavorites}</Text>
            ) : (
              favorites.map((f) => (
                <Pressable
                  key={f.id}
                  style={styles.favChip}
                  onPress={() => sendFavorite(f)}
                  onLongPress={() => removeFavorite(f)}
                  delayLongPress={450}
                  testID={`fav-chip-${f.id}`}
                  accessibilityHint={t.deleteFavorite}
                >
                  <Text style={styles.favChipText} numberOfLines={1}>{f.text}</Text>
                </Pressable>
              ))
            )}
          </ScrollView>
          {mode === "sign" ? (
            <View style={styles.signControls}>
              <Pressable
                style={[styles.recordBtn, recordingSign && styles.recordBtnActive]}
                onPress={() => (recordingSign ? recorder.stop() : camPerm?.granted ? recorder.start() : requestCamPerm())}
                disabled={loading}
                testID="record-sign-btn"
                accessibilityLabel={recordingSign ? t.tapToStop : t.tapToRecord}
              >
                {loading ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.recordBtnText}>
                    {recordingSign ? "⏹" : "🎥"}
                  </Text>
                )}
              </Pressable>
              <Text style={styles.recordHint}>{recordingSign ? t.tapToStop : t.tapToRecord}</Text>
            </View>
          ) : (
            <View style={styles.voiceRow}>
              <TextInput
                style={styles.textInput}
                value={text}
                onChangeText={setText}
                placeholder={t.typeMessage}
                placeholderTextColor={colors.muted}
                testID="text-input"
                onSubmitEditing={sendText}
              />
              {text.trim() ? (
                <Pressable style={styles.sendBtn} onPress={sendText} testID="send-btn">
                  {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.sendText}>➤</Text>}
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.sendBtn, recordingVoice && styles.recordBtnActive]}
                  onPressIn={startRecordVoice}
                  onPressOut={recordingVoice ? stopRecordVoice : undefined}
                  testID="record-voice-btn"
                >
                  {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.sendText}>{recordingVoice ? "⏹" : "🎤"}</Text>}
                </Pressable>
              )}
            </View>
          )}
        </View>
      </View>
      <ContactPicker visible={shareText !== null} text={shareText} onClose={() => setShareText(null)} />
      <PhraseSheet
        visible={phrasesOpen}
        onClose={() => setPhrasesOpen(false)}
        onSend={sendPhrase}
        onFavorite={saveFavorite}
        isFavorite={isFav}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  headerRight: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  langPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  langPillText: { color: colors.onSurface, fontWeight: "700", fontSize: 12 },
  clearBtn: { padding: spacing.xs },
  clearText: { fontSize: 18 },
  top: { height: 260, marginHorizontal: spacing.lg, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceSecondary },
  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: 80 },
  recBadge: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(239,68,68,0.9)",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  permAsk: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  permIcon: { fontSize: 40 },
  permTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  primaryBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "700" },
  avatarWrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0a0b0f" },
  avatarVideo: { width: "100%", height: "100%", borderRadius: 0, marginBottom: 0 },
  avatarCredits: { position: "absolute", top: spacing.sm, left: spacing.md, right: spacing.md, color: "rgba(255,255,255,0.75)", fontSize: 10, textAlign: "center" },
  avatarEmpty: { alignItems: "center", gap: spacing.sm },
  avatarEmptyIcon: { fontSize: 60 },
  avatarEmptyText: { color: colors.onSurfaceTertiary, fontSize: 14 },
  modeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  modeBtnActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  modeText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  modeTextActive: { color: colors.brandPrimary },
  chat: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  emptyChat: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyChatText: { color: colors.muted, fontSize: 14, textAlign: "center" },
  bubble: {
    maxWidth: "85%",
    padding: spacing.md,
    borderRadius: radius.md,
    marginVertical: 4,
  },
  bubbleLeft: { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: 4 },
  bubbleRight: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary, borderTopRightRadius: 4 },
  bubbleLabel: { color: colors.onSurfaceTertiary, fontSize: 11, marginBottom: 4, fontWeight: "700" },
  bubbleMeta: { color: colors.onSurfaceTertiary, fontSize: 12, fontStyle: "italic", marginBottom: 4 },
  bubbleText: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  replayBtn: { marginTop: spacing.sm, alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 4, backgroundColor: "rgba(0,0,0,0.25)", borderRadius: radius.sm, minHeight: 28, justifyContent: "center" },
  replayText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  bubbleActions: { flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" },
  toast: { alignSelf: "center", backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  toastText: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  favScroll: { flexGrow: 0, marginBottom: spacing.sm },
  favRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg },
  favStar: { fontSize: 14 },
  phrasesChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, minHeight: 36, justifyContent: "center" },
  phrasesChipText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 13 },
  favEmpty: { color: colors.muted, fontSize: 12 },
  favChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary, maxWidth: 220, minHeight: 36, justifyContent: "center" },
  favChipText: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: 13 },
  controls: { paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md, backgroundColor: colors.surface },
  recordBtn: {
    alignSelf: "center",
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  recordBtnActive: { backgroundColor: colors.error },
  recordBtnText: { fontSize: 32 },
  signControls: { alignItems: "center", gap: spacing.xs },
  recordHint: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "600" },
  renderingBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-end", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  renderingText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  voiceRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  textInput: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    color: colors.onSurface,
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: colors.onBrandPrimary, fontSize: 20, fontWeight: "800" },
});
