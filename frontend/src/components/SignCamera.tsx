import React, { forwardRef, memo } from "react";
import { StyleSheet } from "react-native";
import { CameraView } from "expo-camera";

type Props = { recording: boolean };

/**
 * Isolated camera preview. `memo` guarantees the native camera controller is NOT re-rendered
 * when the parent (translator) updates state (live sign, chips, toasts…), which removes preview flicker.
 * While recording, autofocus is switched off so the lens stays locked (expo-camera has no exposure lock API).
 */
export const SignCamera = memo(
  forwardRef<CameraView, Props>(function SignCamera({ recording }, ref) {
    return (
      <CameraView
        ref={ref}
        style={styles.camera}
        facing="front"
        autofocus={recording ? "off" : "on"}
        animateShutter={false}
        mute
        testID="camera-view"
      />
    );
  }),
  (prev, next) => prev.recording === next.recording
);

const styles = StyleSheet.create({
  camera: { width: "100%", height: "100%" },
});
