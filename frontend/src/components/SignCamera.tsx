import React, { forwardRef, memo } from "react";
import { StyleSheet } from "react-native";
import { CameraView } from "expo-camera";

type Props = { recording: boolean; facing?: "front" | "back"; mode?: "picture" | "video" };

/**
 * Isolated camera preview. `memo` guarantees the native camera controller is NOT re-rendered
 * when the parent (translator) updates state (live sign, chips, toasts…), which removes preview flicker.
 * While recording, autofocus is switched off so the lens stays locked (expo-camera has no exposure lock API).
 */
export const SignCamera = memo(
  forwardRef<CameraView, Props>(function SignCamera({ recording, facing = "front", mode = "picture" }, ref) {
    return (
      <CameraView
        ref={ref}
        style={styles.camera}
        facing={facing}
        mode={mode}
        autofocus={recording ? "off" : "on"}
        animateShutter={false}
        mute
        testID="camera-view"
      />
    );
  }),
  (prev, next) => prev.recording === next.recording && prev.facing === next.facing && prev.mode === next.mode
);

const styles = StyleSheet.create({
  camera: { width: "100%", height: "100%" },
});
