import { Link, useRouterState } from "@tanstack/react-router";
import { BookOpen, CalendarDays, Plus, Search, Settings, Sunrise } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { applyTheme, useJournal } from "@/lib/journal/store";
import { useCopy } from "@/components/journal/use-copy";
import { Toaster } from "sonner";

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hydrate = useJournal((state) => state.hydrate);
  const hydrated = useJournal((state) => state.hydrated);
  const locked = useJournal((state) => state.locked);
  const settings = useJournal((state) => state.settings);
  const setOnline = useJournal((state) => state.setOnline);
  const lock = useJournal((state) => state.lock);
  const { t } = useCopy();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    applyTheme(settings.theme);
    document.documentElement.lang = settings.language === "en" ? "en" : "zh-Hant";
    if (settings.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [hydrated, settings.theme, settings.language]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [setOnline]);

  useEffect(() => {
    if (!settings.pinHash || settings.autoLockMinutes <= 0 || locked) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lock(), settings.autoLockMinutes * 60_000);
    };
    arm();
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [settings.pinHash, settings.autoLockMinutes, locked, lock]);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const base = import.meta.env.BASE_URL || "/";
    void navigator.serviceWorker.register(`${base}sw.js`).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as Event & { prompt: () => Promise<void> };
      (window as Window & { quireInstall?: { prompt: () => Promise<void> } }).quireInstall = promptEvent;
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (pathname.startsWith("/print")) return <>{children}</>;
  if (!hydrated) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-6 text-fg">
        <div className="text-center">
          <p className="font-serif text-5xl">Quire</p>
          <p className="mt-3 text-muted">{t("boot")}</p>
        </div>
      </main>
    );
  }
  if (locked) return <LockScreen />;

  const immersive = pathname.startsWith("/entry") || pathname.startsWith("/write");
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <Toaster position="top-center" />
      <div className="mx-auto flex min-h-dvh max-w-6xl">
        <Sidebar />
        <div className={cn("min-w-0 flex-1", immersive ? "pb-6" : "pb-nav md:pb-0")}>
          <StatusBanners />
          {children}
        </div>
      </div>
      {immersive ? null : <MobileNav />}
    </div>
  );
}

function Sidebar() {
  const { t } = useCopy();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line px-4 py-6 md:flex">
      <Link to="/" className="px-3 font-serif text-3xl">
        Quire
      </Link>
      <p className="mt-1 px-3 text-sm text-muted">{t("tagline")}</p>
      <nav className="mt-8 flex flex-col gap-1">
        <SideLink to="/" label={t("home")} icon={<BookOpen size={18} />} />
        <SideLink to="/calendar" label={t("calendar")} icon={<CalendarDays size={18} />} />
        <SideLink to="/search" label={t("search")} icon={<Search size={18} />} />
        <SideLink to="/memories" label={t("memories")} icon={<Sunrise size={18} />} />
        <SideLink to="/settings" label={t("settings")} icon={<Settings size={18} />} />
      </nav>
      <div className="mt-auto">
        <Button asChild variant="primary" className="w-full">
          <Link to="/write" search={{ date: undefined }}>
            <Plus size={18} />
            {t("writeToday")}
          </Link>
        </Button>
      </div>
    </aside>
  );
}

function SideLink({ to, label, icon }: { to: "/" | "/calendar" | "/search" | "/memories" | "/settings"; label: string; icon: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-control px-3 text-sm",
        active ? "bg-bg-elev text-fg" : "text-muted",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

function MobileNav() {
  const { t } = useCopy();
  return (
    <nav className="nav-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card md:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        <Tab to="/" label={t("home")} icon={<BookOpen size={20} />} />
        <Tab to="/calendar" label={t("calendar")} icon={<CalendarDays size={20} />} />
        <Link to="/write" search={{ date: undefined }} className="grid place-items-center" aria-label={t("writeToday")}>
          <span className="grid size-12 place-items-center rounded-full bg-clay text-clay-fg">
            <Plus size={22} />
          </span>
        </Link>
        <Tab to="/search" label={t("search")} icon={<Search size={20} />} />
        <Tab to="/memories" label={t("memories")} icon={<Sunrise size={20} />} />
      </div>
    </nav>
  );
}

function Tab({ to, label, icon }: { to: "/" | "/calendar" | "/search" | "/memories"; label: string; icon: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
  return (
    <Link to={to} className={cn("grid min-h-16 place-items-center text-xs", active ? "text-fg" : "text-muted")}>
      {icon}
      <span>{label}</span>
    </Link>
  );
}

function StatusBanners() {
  const online = useJournal((state) => state.online);
  const conflicts = useJournal((state) => state.conflicts);
  const { t } = useCopy();
  if (online && conflicts.length === 0) return null;
  return (
    <div className="space-y-2 px-4 pt-4 md:px-8">
      {online ? null : <p className="rounded-control bg-bg-elev px-3 py-2 text-sm text-muted">{t("offline")}</p>}
      {conflicts.length > 0 ? (
        <Link to="/settings" className="block rounded-control bg-clay px-3 py-2 text-sm text-clay-fg">
          {t("conflictBanner")}
        </Link>
      ) : null}
    </div>
  );
}

function LockScreen() {
  const unlock = useJournal((state) => state.unlock);
  const { t } = useCopy();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  async function submit(value = pin) {
    if (value.length < 4) return;
    try {
      await unlock(value);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(code === "PIN_WAIT" ? t("pinWait") : t("wrongPin"));
      setPin("");
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-fg">
      <div className="w-full max-w-xs text-center">
        <p className="font-serif text-5xl">Quire</p>
        <p className="mt-2 text-sm text-muted">{t("tagline")}</p>
        <div className="mt-8 flex justify-center gap-2" aria-hidden="true">
          {Array.from({ length: Math.max(4, pin.length) }).map((_, index) => (
            <span key={index} className={cn("size-2.5 rounded-full", index < pin.length ? "bg-clay" : "bg-line")} />
          ))}
        </div>
        <p className="mt-3 min-h-5 text-sm text-danger" role="alert">
          {error}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {digits.map((digit) =>
            digit === "" ? (
              <span key="spacer" />
            ) : (
              <button
                key={digit}
                type="button"
                className="min-h-14 rounded-control bg-card text-xl"
                onClick={() => {
                  if (digit === "⌫") {
                    setPin((current) => current.slice(0, -1));
                    return;
                  }
                  setError("");
                  setPin((current) => `${current}${digit}`.slice(0, 8));
                }}
              >
                {digit}
              </button>
            ),
          )}
        </div>
        <Button variant="primary" className="mt-4 w-full" onClick={() => void submit()} disabled={pin.length < 4}>
          {t("unlock")}
        </Button>
      </div>
    </main>
  );
}
