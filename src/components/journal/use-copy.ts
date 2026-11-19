import { greeting, moodLabel, translate, type CopyKey } from "@/lib/journal/i18n";
import { useJournal } from "@/lib/journal/store";
import type { Mood } from "@/lib/journal/types";

export function useCopy() {
  const language = useJournal((state) => state.settings.language);
  return {
    language,
    t: (key: CopyKey) => translate(language, key),
    mood: (mood: Mood) => moodLabel(language, mood),
    hello: translate(language, greeting(language)),
  };
}
