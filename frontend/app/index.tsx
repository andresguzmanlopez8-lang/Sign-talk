import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { getToken } from "@/src/api";
import { api } from "@/src/api";
import { colors, spacing } from "@/src/theme";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) {
        router.replace("/phone");
        return;
      }
      try {
        const me = await api.me();
        if (!me.onboarded) {
          router.replace("/onboarding");
        } else {
          router.replace("/(tabs)/translator");
        }
      } catch {
        router.replace("/phone");
      }
    })();
  }, [router]);

  return (
    <View style={styles.container} testID="splash-screen">
      <Text style={styles.logo}>SignBridge</Text>
      <ActivityIndicator size="large" color={colors.brandPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
  },
  logo: {
    color: colors.onSurface,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1,
  },
});
