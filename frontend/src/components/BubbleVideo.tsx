import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, StyleProp, ViewStyle } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";
import { useSignSpeed, SPEED_RATE, SPEED_ORDER, SignSpeed } from "@/src/signSpeed";

type Props = { uri: string; testID?: string; style?: StyleProp<ViewStyle>; credits?: string[] | null };

/** Native video player embedded inside a chat bubble (never opens a link / leaves the app).
 *  Includes the shared avatar speed selector (lenta / normal / rápida) to learn at your own pace. */
export default function BubbleVideo({ uri, testID, style, credits }: Props) {
  const { t } = useLang();
  const [speed, setSpeed] = useSignSpeed();
  const [ready, setReady] = useState(false);
  // Web browsers without H.264 (e.g. Chromium) get the WebM twin; native players use MP4.
  const source = Platform.OS === "web" ? uri.replace(/\.mp4$/, ".webm") : uri;
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.playbackRate = SPEED_RATE[speed];
    p.play();
  });
  const { isPlaying: playing } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const showSpinner = !ready && status !== "readyToPlay" && status !== "error";

  useEffect(() => {
    try {
      player.playbackRate = SPEED_RATE[speed];
    } catch {}
  }, [player, speed]);

  const cycleSpeed = () => {
    Haptics.selectionAsync().catch(() => {});
    const next: SignSpeed = SPEED_ORDER[(SPEED_ORDER.indexOf(speed) + 1) % SPEED_ORDER.length];
    setSpeed(next);
  };
  const speedLabel = speed === "slow" ? t.speedSlow : speed === "fast" ? t.speedFast : t.speedNormal;

  return (
    <View style={style ? undefined : styles.block}>
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
        style={styles.speedBtn}
        onPress={cycleSpeed}
        testID="bubble-video-speed"
        accessibilityLabel={`${t.signSpeed}: ${speedLabel}`}
      >
        <Text style={styles.speedText}>{speed === "slow" ? "🐢" : speed === "fast" ? "🐇" : "⏱"} {SPEED_RATE[speed]}× · {speedLabel}</Text>
      </Pressable>
      <Pressable
        style={styles.playBtn}
        onPress={() => (playing ? player.pause() : player.play())}
        testID="bubble-video-toggle"
        accessibilityLabel={playing ? "Pausar" : "Reproducir"}
      >
        <Text style={styles.playText}>{playing ? "⏸" : "▶"}</Text>
      </Pressable>
    </View>
    {!!credits?.length && (
      <Text style={styles.credits} testID={`${testID ?? "bubble-video"}-credits`} numberOfLines={2}>
        🎥 {credits.join(" · ")}
      </Text>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.sm },
  wrap: { width: 220, height: 220, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceTertiary },
  credits: { color: "rgba(255,255,255,0.65)", fontSize: 10, marginTop: 4, maxWidth: 220 },
  video: { width: "100%", height: "100%" },
  overlay: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  speedBtn: { position: "absolute", left: spacing.sm, bottom: spacing.sm, minHeight: 32, paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center" },
  speedText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  playBtn: { position: "absolute", right: spacing.sm, bottom: spacing.sm, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  playText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
