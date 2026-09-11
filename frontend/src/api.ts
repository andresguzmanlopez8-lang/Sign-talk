import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;

const TOKEN_KEY = "signbridge_token";

export async function saveToken(token: string) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}
export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}
export async function clearToken() {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean; form?: FormData } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (!opts.form) headers["Content-Type"] = "application/json";
  if (opts.auth !== false) {
    const t = await getToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.form ? (opts.form as any) : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  base: BASE,
  sendOtp: (phone: string, country_code: string) =>
    request<{ success: boolean; mock_otp: string }>("/auth/send-otp", {
      method: "POST",
      body: { phone, country_code },
      auth: false,
    }),
  verifyOtp: (phone: string, country_code: string, otp: string) =>
    request<{ token: string; user: any; new_user: boolean }>("/auth/verify-otp", {
      method: "POST",
      body: { phone, country_code, otp },
      auth: false,
    }),
  me: () => request<any>("/auth/me"),
  onboard: (name: string, photo_url: string | null, language: "es" | "en") =>
    request<any>("/auth/onboard", { method: "POST", body: { name, photo_url, language } }),
  updateProfile: (payload: any) =>
    request<any>("/auth/profile", { method: "PATCH", body: payload }),
  dictionary: (opts: { language?: string; q?: string; letter?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.language) qs.set("language", opts.language);
    if (opts.q) qs.set("q", opts.q);
    if (opts.letter) qs.set("letter", opts.letter);
    return request<any[]>(`/dictionary?${qs.toString()}`);
  },
  signToText: (language: "es" | "en", hint?: string) =>
    request<any>("/translate/sign-to-text", { method: "POST", body: { language, hint } }),
  textToSign: (text: string, language: "es" | "en") =>
    request<any>("/translate/text-to-sign", { method: "POST", body: { text, language } }),
  voiceToText: async (audioUri: string, language: "es" | "en") => {
    const form = new FormData();
    form.append("language", language);
    form.append("audio", {
      uri: audioUri,
      name: "recording.m4a",
      type: "audio/m4a",
    } as any);
    return request<any>("/translate/voice-to-text", { method: "POST", form });
  },
  messages: () => request<any[]>("/messages"),
  clearMessages: () => request<any>("/messages", { method: "DELETE" }),
  tts: (text: string, voice = "nova") =>
    request<{ url: string }>("/tts", { method: "POST", body: { text, voice } }),
  favorites: (language?: "es" | "en") =>
    request<any[]>(`/favorites${language ? `?language=${language}` : ""}`),
  addFavorite: (text: string, language: "es" | "en") =>
    request<any>("/favorites", { method: "POST", body: { text, language } }),
  deleteFavorite: (id: string) => request<any>(`/favorites/${id}`, { method: "DELETE" }),
  learnToday: (language: "es" | "en") => request<any>(`/learn/today?language=${language}`),
  learnProgress: () => request<any>("/learn/progress"),
  learnComplete: (payload: { language: "es" | "en"; correct_ids: string[]; wrong_ids: string[]; score: number; total: number }) =>
    request<any>("/learn/complete", { method: "POST", body: payload }),
  learnReview: (language: "es" | "en") => request<any>(`/learn/review?language=${language}`),
  learnReviewComplete: (payload: { language: "es" | "en"; correct_ids: string[]; wrong_ids: string[]; score: number; total: number }) =>
    request<any>("/learn/review/complete", { method: "POST", body: payload }),
  achievements: (language: "es" | "en") => request<any>(`/learn/achievements?language=${language}`),
  phrases: (language: "es" | "en") => request<any>(`/phrases?language=${language}`, { auth: false }),
};
