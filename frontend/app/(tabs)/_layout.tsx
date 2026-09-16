import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View, StyleSheet } from "react-native";
import { api } from "@/src/api";
import { colors, spacing } from "@/src/theme";
import { useLang } from "@/src/lang";

const UNREAD_POLL_MS = 5000;

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={styles.iconWrap}>
      <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{label}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { t } = useLang();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const load = () => api.chatUnread().then((r) => setUnread(r.unread)).catch(() => {});
    load();
    const iv = setInterval(load, UNREAD_POLL_MS);
    return () => clearInterval(iv);
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          paddingTop: 8,
          height: 60 + (insets.bottom > 0 ? insets.bottom : 8),
        },
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontWeight: "700", fontSize: 11 },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarBadgeStyle: { backgroundColor: colors.brandPrimary, color: colors.onBrandPrimary, fontWeight: "800", fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="translator"
        options={{
          title: t.translator,
          tabBarIcon: ({ focused }) => <TabIcon label="🔄" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: t.chats,
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarIcon: ({ focused }) => <TabIcon label="💬" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="dictionary"
        options={{
          title: t.dictionary,
          tabBarIcon: ({ focused }) => <TabIcon label="📖" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: t.learn,
          tabBarIcon: ({ focused }) => <TabIcon label="🎓" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t.profile,
          tabBarIcon: ({ focused }) => <TabIcon label="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignItems: "center", justifyContent: "center" },
});
