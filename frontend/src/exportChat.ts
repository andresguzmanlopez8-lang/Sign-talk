import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

type Msg = {
  direction: "sign_to_text" | "text_to_sign" | "voice_to_text";
  language: "es" | "en";
  original_text?: string | null;
  translated_text: string;
  created_at: string;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const DIRECTION_LABEL = {
  es: { sign_to_text: "Señas → Texto", text_to_sign: "Texto → Señas", voice_to_text: "Voz → Señas" },
  en: { sign_to_text: "Sign → Text", text_to_sign: "Text → Sign", voice_to_text: "Voice → Sign" },
};

export function buildChatHtml(messages: Msg[], opts: { title: string; userName?: string | null; lang: "es" | "en" }) {
  const locale = opts.lang === "es" ? "es-MX" : "en-US";
  const rows = messages
    .map((m) => {
      const isSign = m.direction === "sign_to_text";
      const when = new Date(m.created_at).toLocaleString(locale);
      const orig =
        m.original_text && m.original_text !== m.translated_text
          ? `<div class="orig">${esc(m.original_text)}</div>`
          : "";
      return `<div class="row ${isSign ? "left" : "right"}">
        <div class="bubble">
          <div class="meta">${DIRECTION_LABEL[opts.lang][m.direction]} · ${when}</div>
          ${orig}
          <div class="text">${esc(m.translated_text)}</div>
        </div>
      </div>`;
    })
    .join("");

  const dateStr = new Date().toLocaleDateString(locale, { dateStyle: "long" } as any);
  const subtitle = [opts.userName, opts.lang === "es" ? "LSM / Español" : "ASL / English", dateStr]
    .filter(Boolean)
    .join(" · ");

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <style>
    @page { margin: 24mm 18mm; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .sub { color: #666; font-size: 12px; margin-bottom: 20px; border-bottom: 2px solid #FF5722; padding-bottom: 10px; }
    .row { display: flex; margin: 8px 0; page-break-inside: avoid; }
    .row.left { justify-content: flex-start; }
    .row.right { justify-content: flex-end; }
    .bubble { max-width: 78%; border: 1px solid #ddd; border-radius: 10px; padding: 8px 12px; }
    .right .bubble { background: #FFF1EC; border-color: #FF5722; }
    .left .bubble { background: #F4F4F6; }
    .meta { font-size: 10px; color: #777; margin-bottom: 4px; }
    .orig { font-size: 12px; color: #666; font-style: italic; margin-bottom: 2px; }
    .text { font-size: 14px; font-weight: 600; }
    .footer { margin-top: 24px; font-size: 10px; color: #999; text-align: center; }
  </style></head><body>
  <h1>SignBridge — ${esc(opts.title)}</h1>
  <div class="sub">${esc(subtitle)} · ${messages.length} ${opts.lang === "es" ? "mensajes" : "messages"}</div>
  ${rows}
  <div class="footer">SignBridge</div>
  </body></html>`;
}

export async function exportChatPdf(messages: Msg[], opts: { title: string; userName?: string | null; lang: "es" | "en" }) {
  const html = buildChatHtml(messages, opts);
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: opts.title });
  }
}
