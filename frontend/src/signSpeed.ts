import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Global avatar playback speed shared by every sign video (persisted). */
export type SignSpeed = "slow" | "normal" | "fast";
export const SPEED_RATE: Record<SignSpeed, number> = { slow: 0.5, normal: 1, fast: 1.5 };
export const SPEED_ORDER: SignSpeed[] = ["slow", "normal", "fast"];

const KEY = "signbridge_sign_speed";
let current: SignSpeed = "normal";
const listeners = new Set<(s: SignSpeed) => void>();
const loaded = AsyncStorage.getItem(KEY)
  .then((v) => {
    if (v === "slow" || v === "normal" || v === "fast") {
      current = v;
      listeners.forEach((l) => l(current));
    }
  })
  .catch(() => {});

export function setSignSpeed(s: SignSpeed) {
  current = s;
  listeners.forEach((l) => l(s));
  AsyncStorage.setItem(KEY, s).catch(() => {});
}

export function useSignSpeed(): [SignSpeed, (s: SignSpeed) => void] {
  const [speed, setSpeed] = useState<SignSpeed>(current);
  useEffect(() => {
    listeners.add(setSpeed);
    loaded.then(() => setSpeed(current));
    return () => {
      listeners.delete(setSpeed);
    };
  }, []);
  return [speed, setSignSpeed];
}
