import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, getToken } from "@/src/api";
import AdInterstitial from "@/src/components/AdInterstitial";

export type PremiumLimits = { sign_record_seconds: number; ad_every_messages: number; avatars: string[] };
export type PremiumStatus = {
  is_premium: boolean;
  plan: "monthly" | "yearly" | null;
  premium_since?: string | null;
  trial_ends_at?: string | null;
  source?: string | null;
  limits: PremiumLimits;
  dev_mode: boolean;
};

export const FREE_STATUS: PremiumStatus = {
  is_premium: false,
  plan: null,
  limits: { sign_record_seconds: 15, ad_every_messages: 10, avatars: ["m1", "f1"] },
  dev_mode: false,
};

const STATUS_KEY = "signbridge_premium_status";
const SENT_KEY = "signbridge_messages_sent";

type Ctx = {
  status: PremiumStatus;
  isPremium: boolean;
  refresh: () => Promise<void>;
  setStatus: (s: PremiumStatus) => void;
  /** Call after every message sent; free users get a (simulated) interstitial every N messages. */
  notifyMessageSent: () => Promise<void>;
};

const PremiumContext = createContext<Ctx>({
  status: FREE_STATUS,
  isPremium: false,
  refresh: async () => {},
  setStatus: () => {},
  notifyMessageSent: async () => {},
});

/** Free vs Premium plan state (mirrors `users.is_premium` in the backend) + ad frequency counter. */
export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatusState] = useState<PremiumStatus>(FREE_STATUS);
  const [adVisible, setAdVisible] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  const setStatus = useCallback((s: PremiumStatus) => {
    setStatusState(s);
    AsyncStorage.setItem(STATUS_KEY, JSON.stringify(s)).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (!(await getToken())) return;
    try {
      setStatus(await api.billingStatus());
    } catch (e) {
      console.warn("billing status", e);
    }
  }, [setStatus]);

  useEffect(() => {
    AsyncStorage.getItem(STATUS_KEY)
      .then((v) => v && setStatusState(JSON.parse(v)))
      .catch(() => {})
      .finally(refresh);
  }, [refresh]);

  const notifyMessageSent = useCallback(async () => {
    const every = statusRef.current.limits.ad_every_messages;
    if (statusRef.current.is_premium || !every) return;
    const n = (parseInt((await AsyncStorage.getItem(SENT_KEY)) ?? "0", 10) || 0) + 1;
    await AsyncStorage.setItem(SENT_KEY, String(n));
    if (n % every === 0) setAdVisible(true);
  }, []);

  return (
    <PremiumContext.Provider value={{ status, isPremium: status.is_premium, refresh, setStatus, notifyMessageSent }}>
      {children}
      <AdInterstitial visible={adVisible} onClose={() => setAdVisible(false)} />
    </PremiumContext.Provider>
  );
}

export function usePremium() {
  return useContext(PremiumContext);
}
