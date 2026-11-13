import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, type Language } from "@/lib/i18n";

export function LanguageSwitcher({
  className,
  floating = false,
}: {
  className?: string;
  floating?: boolean;
}) {
  const { language, setLanguage } = useI18n();

  const choose = (next: Language) => {
    if (next !== language) setLanguage(next);
  };

  return (
    <div
      data-no-translate
      data-language-switcher
      role="group"
      aria-label="Language / اللغة"
      className={cn(
        "flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--card)]/95 p-1 shadow-sm backdrop-blur",
        floating && "fixed bottom-5 z-[100]",
        className,
      )}
      style={floating ? { insetInlineEnd: "1.25rem" } : undefined}
    >
      <Languages className="mx-1 size-4 text-muted-foreground" />
      <button
        type="button"
        onClick={() => choose("en")}
        aria-pressed={language === "en"}
        className={cn(
          "rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
          language === "en"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        English
      </button>
      <button
        type="button"
        onClick={() => choose("ar")}
        aria-pressed={language === "ar"}
        className={cn(
          "rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
          language === "ar"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        العربية
      </button>
    </div>
  );
}
