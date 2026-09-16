import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, StyleProp, ViewStyle } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";
import { colors, spacing, radius } from "@/src/theme";

type Props = { uri: string; testID?: string; style?: StyleProp<ViewStyle> };

/** Native video player embedded inside a chat bubble (never opens a link / leaves the app). */
export default function BubbleVideo({ uri, testID, style }: Props) {
  const [ready, setReady] = useState(false);
  // Web browsers without H.264 (e.g. Chromium) get the WebM twin; native players use MP4.
  const source = Platform.OS === "web" ? uri.replace(/\.mp4$/, ".webm") : uri;
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  const { isPlaying: playing } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const showSpinner = !ready && status !== "readyToPlay" && status !== "error";

  return (
    <View style={[styles.wrap, style]} testID={testID ?? "bubble-video"}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        onFirstFrameRender={() => setReady(true)}
      />
      {showSpinner && (
        <View style={styles.overlay} testID="bubble-video-loading">
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      )}
      <Pressable
        style={styles.playBtn}
        onPress={() => (playing ? player.pause() : player.play())}
        testID="bubble-video-toggle"
        accessibilityLabel={playing ? "Pausar" : "Reproducir"}
      >
        <Text style={styles.playText}>{playing ? "⏸" : "▶"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 220, height: 220, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceTertiary, marginBottom: spacing.sm },
  video: { width: "100%", height: "100%" },
  overlay: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  playBtn: { position: "absolute", right: spacing.sm, bottom: spacing.sm, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  playText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
