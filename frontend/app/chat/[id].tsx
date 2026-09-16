import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync, createAudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { usePremium } from "@/src/premium";
import ChatBubble, { ChatMsg } from "@/src/components/ChatBubble";
import SignCaptureSheet from "@/src/components/SignCaptureSheet";

const POLL_MS = 2500;
type Peer = { id: string; name: string; phone: string; photo_url?: string | null };

/** 1:1 conversation. Every message is text underneath; each bubble can be listened (TTS) or watched as avatar signs. */
export default function ChatScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, lang } = useLang();
  const { isPremium, notifyMessageSent } = usePremium();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState<null | "text" | "voice" | "sign">(null);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shownVideos, setShownVideos] = useState<Set<string>>(new Set());
  const [loadingVideo, setLoadingVideo] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const lastRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<ChatMsg>>(null);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const playerRef = useRef<any>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const scrollToEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);

  const merge = useCallback((incoming: ChatMsg[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const add = incoming.filter((m) => !ids.has(m.id));
      return add.length ? [...prev, ...add] : prev;
    });
    lastRef.current = incoming[incoming.length - 1].created_at;
    scrollToEnd();
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.chatMessages(id, lastRef.current);
      if (res.peer) setPeer(res.peer);
      setMe(res.me);
      merge(res.items);
    } catch (e) {
      console.warn("chat load", e);
    } finally {
      setLoaded(true);
    }
  }, [id, merge]);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    load();
    const iv = setInterval(load, POLL_MS);
    return () => {
      clearInterval(iv);
      playerRef.current?.remove?.();
    };
  }, [load]);

  const sendText = async () => {
    const value = text.trim();
    if (!value || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending("text");
    setText("");
    try {
      merge([await api.chatSend(id, { kind: "text", text: value, language: lang })]);
      notifyMessageSent();
    } catch (e: any) {
      showToast(e?.message ?? "Error");
      setText(value);
    } finally {
      setSending(null);
    }
  };

  const sendSigns = async (signs: string[]) => {
    setSignOpen(false);
    setSending("sign");
    try {
      merge([await api.chatSend(id, { kind: "sign", signs, language: lang })]);
      notifyMessageSent();
    } catch (e: any) {
      showToast(e?.message ?? t.recognitionError);
    } finally {
      setSending(null);
    }
  };

  const onSignLimitReached = () => {
    setSignOpen(false);
    if (!isPremium) router.push({ pathname: "/paywall", params: { reason: "limit" } });
  };

  const startVoice = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setRecordingVoice(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      console.warn("start rec", e);
    }
  };

  const stopVoice = async () => {
    if (!recordingVoice) return;
    setRecordingVoice(false);
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (!uri) return;
      setSending("voice");
      merge([await api.chatSendVoice(id, uri, lang)]);
      notifyMessageSent();
    } catch (e: any) {
      showToast(e?.message ?? "Error");
    } finally {
      setSending(null);
    }
  };

  const listen = async (msg: ChatMsg) => {
    Haptics.selectionAsync().catch(() => {});
    setPlayingId(msg.id);
    try {
      const tts = await api.tts(msg.text, msg.language === "es" ? "nova" : "alloy");
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      playerRef.current?.remove?.();
      const player = createAudioPlayer({ uri: `${api.base}${tts.url}` });
      playerRef.current = player;
      player.play();
    } catch (e) {
      console.warn("tts", e);
    } finally {
      setPlayingId(null);
    }
  };

  const toggleSign = async (msg: ChatMsg) => {
    Haptics.selectionAsync().catch(() => {});
    if (shownVideos.has(msg.id)) {
      setShownVideos((prev) => {
        const next = new Set(prev);
        next.delete(msg.id);
        return next;
      });
      return;
    }
    if (!msg.video_url) {
      setLoadingVideo(msg.id);
      try {
        const updated = await api.chatSignVideo(msg.id);
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, video_url: updated.video_url } : m)));
      } catch (e: any) {
        showToast(e?.message ?? "Error");
        return;
      } finally {
        setLoadingVideo(null);
      }
    }
    setShownVideos((prev) => new Set(prev).add(msg.id));
  };

  const peerName = peer?.name || name || "";

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} testID="chat-back">
            <Text style={styles.backText}>←</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <View style={styles.headerAvatar}>
              <Text style={styles.headerAvatarText}>{peerName[0]?.toUpperCase() ?? "?"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1} testID="chat-peer-name">{peerName}</Text>
              {peer?.phone && <Text style={styles.subtitle}>{peer.phone}</Text>}
            </View>
          </View>
          <Text style={styles.langTag}>{lang === "es" ? "LSM" : "ASL"}</Text>
        </View>

        {toast && (
          <View style={styles.toast} testID="chat-toast">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}

        {!loaded ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            onContentSizeChange={scrollToEnd}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <ChatBubble
                msg={item}
                mine={item.sender_id === me}
                videoShown={shownVideos.has(item.id)}
                loadingVideo={loadingVideo === item.id}
                playingAudio={playingId === item.id}
                onListen={listen}
                onToggleSign={toggleSign}
              />
            )}
            ListEmptyComponent={
              <View style={styles.empty} testID="chat-empty">
                <Text style={styles.emptyIcon}>🤟</Text>
                <Text style={styles.emptyText}>{t.chatEmpty}</Text>
              </View>
            }
          />
        )}

        {sending && (
          <View style={styles.sendingBox} testID="chat-sending">
            <ActivityIndicator color={colors.brandPrimary} size="small" />
            <Text style={styles.sendingText}>{sending === "voice" ? t.sendingVoice : t.sending}</Text>
          </View>
        )}

        <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable style={styles.iconBtn} onPress={() => setSignOpen(true)} disabled={!!sending} testID="chat-sign-btn" accessibilityLabel={t.sendSigns}>
            <Text style={styles.iconText}>👐</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={recordingVoice ? t.recording : t.typeMessage}
            placeholderTextColor={colors.muted}
            onSubmitEditing={sendText}
            returnKeyType="send"
            testID="chat-input"
          />
          {text.trim() ? (
            <Pressable style={styles.sendBtn} onPress={sendText} disabled={!!sending} testID="chat-send-btn">
              <Text style={styles.sendText}>➤</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.sendBtn, recordingVoice && styles.recording]}
              onPressIn={startVoice}
              onPressOut={stopVoice}
              disabled={!!sending}
              testID="chat-voice-btn"
              accessibilityLabel={t.holdToRecord}
            >
              <Text style={styles.sendText}>{recordingVoice ? "⏹" : "🎤"}</Text>
            </Pressable>
          )}
        </View>
      </View>
      <SignCaptureSheet visible={signOpen} onClose={() => setSignOpen(false)} onDone={sendSigns} onLimitReached={onSignLimitReached} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.onSurface, fontSize: 24 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.brandPrimary },
  headerAvatarText: { color: colors.onBrandTertiary, fontWeight: "800" },
  title: { color: colors.onSurface, fontSize: 17, fontWeight: "800" },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 11 },
  langTag: { color: colors.brandPrimary, fontWeight: "800", fontSize: 12, paddingHorizontal: spacing.sm },
  toast: { alignSelf: "center", backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border },
  toastText: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  list: { padding: spacing.lg, gap: spacing.xs, flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center" },
  sendingBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-end", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border },
  sendingText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  composer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  iconBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  iconText: { fontSize: 22 },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, color: colors.onSurface, height: 48, borderWidth: 1, borderColor: colors.border },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  recording: { backgroundColor: colors.error },
  sendText: { color: colors.onBrandPrimary, fontSize: 20, fontWeight: "800" },
});
