import { createContext, useContext } from "react";
import { STRINGS, Lang } from "./constants";

export const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "es",
  setLang: () => {},
});

export function useLang() {
  const { lang, setLang } = useContext(LangContext);
  return { lang, setLang, t: STRINGS[lang] };
}
