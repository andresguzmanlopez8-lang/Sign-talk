import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { api } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import BubbleVideo from "@/src/components/BubbleVideo";

export type ChatMsg = {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: "text" | "voice" | "sign";
  text: string;
  language: "es" | "en";
  signs?: string[] | null;
  video_url?: string | null;
  video_credits?: string[] | null;
  avatar_id?: string | null;
  created_at: string;
};

type Props = {
  msg: ChatMsg;
  mine: boolean;
  videoShown: boolean;
  loadingVideo: boolean;
  playingAudio: boolean;
  onListen: (msg: ChatMsg) => void;
  onToggleSign: (msg: ChatMsg) => void;
};

const KIND_ICON: Record<ChatMsg["kind"], string> = { text: "💬", voice: "🎤", sign: "👐" };

export function formatTime(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** One chat message: text + 🔊 listen (TTS) + 🤟 show as avatar sign video (rendered on demand). */
export default function ChatBubble({ msg, mine, videoShown, loadingVideo, playingAudio, onListen, onToggleSign }: Props) {
  const { t } = useLang();
  const kindLabel = msg.kind === "voice" ? t.voiceMessage : msg.kind === "sign" ? t.signMessage : t.textMessage;
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]} testID={`chat-msg-${msg.id}`}>
      <Text style={styles.label}>
        {KIND_ICON[msg.kind]} {kindLabel}
        {msg.kind === "sign" && msg.signs?.length ? ` · ${msg.signs.join(" ")}` : ""}
      </Text>
      {videoShown && msg.video_url && <BubbleVideo uri={`${api.base}${msg.video_url}`} credits={msg.video_credits} testID={`chat-video-${msg.id}`} />}
      <Text style={styles.text} testID={`chat-text-${msg.id}`}>{msg.text}</Text>
      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtn, playingAudio && styles.actionActive]}
          onPress={() => onListen(msg)}
          testID={`chat-listen-${msg.id}`}
          accessibilityLabel={t.listenMsg}
        >
          {playingAudio ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.actionText}>🔊 {t.listenMsg}</Text>}
        </Pressable>
        <Pressable
          style={[styles.actionBtn, videoShown && styles.actionActive]}
          onPress={() => onToggleSign(msg)}
          disabled={loadingVideo}
          testID={`chat-sign-${msg.id}`}
          accessibilityLabel={videoShown ? t.hideSign : t.showAsSign}
        >
          {loadingVideo ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.actionText}>🤟 {videoShown ? t.hideSign : t.showAsSign}</Text>
          )}
        </Pressable>
        <Text style={styles.time}>{formatTime(msg.created_at)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: "85%", padding: spacing.md, borderRadius: radius.md, marginVertical: 3 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: 4 },
  mine: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary, borderTopRightRadius: 4 },
  label: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginBottom: 4, fontWeight: "700" },
  text: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  actions: { flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap", marginTop: spacing.sm },
  actionBtn: { paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: "rgba(0,0,0,0.25)", borderRadius: radius.sm, minHeight: 32, justifyContent: "center" },
  actionActive: { backgroundColor: "rgba(0,0,0,0.5)" },
  actionText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  time: { color: "rgba(255,255,255,0.6)", fontSize: 10, marginLeft: "auto" },
});
