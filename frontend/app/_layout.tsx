import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox, StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { LangContext } from "@/src/lang";
import { Lang } from "@/src/constants";
import { colors } from "@/src/theme";
import { PremiumProvider } from "@/src/premium";

LogBox.ignoreAllLogs(true);

const LANG_KEY = "signbridge_lang";

export default function RootLayout() {
  const [lang, setLangState] = useState<Lang>("es");

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((v) => {
      if (v === "es" || v === "en") setLangState(v);
    });
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(LANG_KEY, l);
  };

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <LangContext.Provider value={{ lang, setLang }}>
              <PremiumProvider>
                <StatusBar barStyle="light-content" backgroundColor={colors.surface} />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.surface },
                    animation: "fade",
                  }}
                >
                  <Stack.Screen name="paywall" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                </Stack>
              </PremiumProvider>
            </LangContext.Provider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
