import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, FlatList, ActivityIndicator, Linking, Platform } from "react-native";
import * as Contacts from "expo-contacts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius } from "@/src/theme";
import { useLang } from "@/src/lang";

type Contact = { id: string; name: string; phone: string };
type PermState = "checking" | "undetermined" | "granted" | "denied" | "blocked" | "unsupported";

export const digitsOnly = (phone: string) => phone.replace(/[^\d]/g, "");

export function openWhatsApp(phone: string, text: string) {
  const digits = digitsOnly(phone);
  return Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`);
}

export function openSms(phone: string, text: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  const sep = Platform.OS === "ios" ? "&" : "?";
  return Linking.openURL(`sms:${digits}${sep}body=${encodeURIComponent(text)}`);
}

type Props = {
  visible: boolean;
  text: string | null;
  onClose: () => void;
};

export default function ContactPicker({ visible, text, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useLang();
  const [perm, setPerm] = useState<PermState>("checking");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [selected, setSelected] = useState<Contact | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSelected(null);
    setQ("");
    if (Platform.OS === "web") {
      setPerm("unsupported");
      return;
    }
    Contacts.getPermissionsAsync()
      .then((res) => {
        if (res.granted) {
          setPerm("granted");
          loadContacts();
        } else if (res.canAskAgain) setPerm("undetermined");
        else setPerm("blocked");
      })
      .catch(() => setPerm("unsupported"));
  }, [visible]);

  const loadContacts = async () => {
    setLoading(true);
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
        sort: Contacts.SortTypes.FirstName,
      });
      const list: Contact[] = [];
      for (const c of data) {
        const phone = c.phoneNumbers?.[0]?.number;
        if (phone && c.name) list.push({ id: c.id ?? `${c.name}-${phone}`, name: c.name, phone });
      }
      setContacts(list);
    } catch (e) {
      console.warn("contacts", e);
    } finally {
      setLoading(false);
    }
  };

  const requestPerm = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const res = await Contacts.requestPermissionsAsync();
    if (res.granted) {
      setPerm("granted");
      loadContacts();
    } else {
      setPerm(res.canAskAgain ? "denied" : "blocked");
    }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(s) || c.phone.includes(s));
  }, [contacts, q]);

  const send = async (channel: "sms" | "whatsapp") => {
    if (!selected || !text) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (channel === "whatsapp") await openWhatsApp(selected.phone, text);
      else await openSms(selected.phone, text);
      onClose();
    } catch (e) {
      console.warn("send", e);
    }
  };

  const renderBody = () => {
    if (selected) {
      return (
        <View style={styles.section} testID="send-options">
          <Text style={styles.sectionTitle}>{t.sendTo}</Text>
          <View style={styles.contactRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{selected.name[0]?.toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactName}>{selected.name}</Text>
              <Text style={styles.contactPhone}>{selected.phone}</Text>
            </View>
            <Pressable onPress={() => setSelected(null)} style={styles.changeBtn} testID="change-contact">
              <Text style={styles.changeText}>{t.change}</Text>
            </Pressable>
          </View>
          <View style={styles.preview}>
            <Text style={styles.previewText} numberOfLines={4}>{text}</Text>
          </View>
          <Pressable style={[styles.channelBtn, styles.whatsapp]} onPress={() => send("whatsapp")} testID="send-whatsapp">
            <Text style={styles.channelText}>💬 WhatsApp</Text>
          </Pressable>
          <Pressable style={[styles.channelBtn, styles.smsBtn]} onPress={() => send("sms")} testID="send-sms">
            <Text style={styles.channelText}>✉️ SMS</Text>
          </Pressable>
        </View>
      );
    }

    if (perm === "checking") return <ActivityIndicator color={colors.brandPrimary} style={{ margin: spacing.xl }} />;

    if (perm === "undetermined" || perm === "denied" || perm === "blocked") {
      return (
        <View style={styles.permBox} testID="contacts-perm">
          <Text style={styles.permIcon}>👥</Text>
          <Text style={styles.permTitle}>{t.permContacts}</Text>
          <Text style={styles.permDesc}>{perm === "blocked" ? t.contactsBlocked : t.contactsWhy}</Text>
          {perm === "blocked" ? (
            <Pressable style={styles.primaryBtn} onPress={() => Linking.openSettings()} testID="open-settings">
              <Text style={styles.primaryBtnText}>{t.openSettings}</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.primaryBtn} onPress={requestPerm} testID="request-contacts">
              <Text style={styles.primaryBtnText}>{t.grantAccess}</Text>
            </Pressable>
          )}
          {renderManual()}
        </View>
      );
    }

    if (perm === "unsupported") {
      return <View style={styles.permBox}>{renderManual()}</View>;
    }

    return (
      <>
        <TextInput
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder={t.searchContacts}
          placeholderTextColor={colors.muted}
          testID="contact-search"
        />
        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ margin: spacing.xl }} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: spacing.lg }}
            renderItem={({ item }) => (
              <Pressable style={styles.contactRow} onPress={() => setSelected(item)} testID={`contact-${item.id}`}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{item.name[0]?.toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactName}>{item.name}</Text>
                  <Text style={styles.contactPhone}>{item.phone}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.empty}>{t.noContacts}</Text>}
            ListFooterComponent={renderManual()}
          />
        )}
      </>
    );
  };

  const renderManual = () => (
    <View style={styles.manual} testID="manual-entry">
      <Text style={styles.manualLabel}>{t.orTypeNumber}</Text>
      <View style={styles.manualRow}>
        <TextInput
          style={[styles.search, { flex: 1, marginBottom: 0 }]}
          value={manualPhone}
          onChangeText={setManualPhone}
          placeholder="+52 55 1234 5678"
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
          testID="manual-phone"
        />
        <Pressable
          style={[styles.primaryBtn, styles.manualBtn, digitsOnly(manualPhone).length < 7 && styles.disabled]}
          disabled={digitsOnly(manualPhone).length < 7}
          onPress={() => setSelected({ id: "manual", name: manualPhone, phone: manualPhone })}
          testID="manual-continue"
        >
          <Text style={styles.primaryBtnText}>➤</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.bg}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="contact-picker">
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t.shareWithContact}</Text>
            <Pressable onPress={onClose} style={styles.close} testID="contact-picker-close">
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          {renderBody()}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "85%", paddingHorizontal: spacing.lg },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md },
  sheetTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeText: { color: colors.onSurface, fontSize: 20 },
  search: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, color: colors.onSurface, height: 44, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  contactRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, minHeight: 56 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.brandPrimary },
  avatarText: { color: colors.onBrandTertiary, fontWeight: "800" },
  contactName: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  contactPhone: { color: colors.onSurfaceTertiary, fontSize: 12 },
  chevron: { color: colors.muted, fontSize: 22 },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.lg },
  section: { gap: spacing.md, paddingBottom: spacing.sm },
  sectionTitle: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  changeBtn: { paddingHorizontal: spacing.md, paddingVertical: 8, minHeight: 36, justifyContent: "center" },
  changeText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 13 },
  preview: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  previewText: { color: colors.onSurfaceSecondary, fontSize: 14 },
  channelBtn: { paddingVertical: spacing.md, borderRadius: radius.pill, alignItems: "center", minHeight: 48, justifyContent: "center" },
  whatsapp: { backgroundColor: "#25D366" },
  smsBtn: { backgroundColor: colors.info },
  channelText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  permBox: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  permIcon: { fontSize: 40 },
  permTitle: { color: colors.onSurface, fontWeight: "800", fontSize: 16 },
  permDesc: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: "center", lineHeight: 18 },
  primaryBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill, minHeight: 44, justifyContent: "center", alignItems: "center" },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "800" },
  disabled: { opacity: 0.4 },
  manual: { width: "100%", marginTop: spacing.md, gap: spacing.sm },
  manualLabel: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  manualRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  manualBtn: { width: 48, paddingHorizontal: 0 },
});
