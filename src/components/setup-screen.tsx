import { useState, type FormEvent } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidPin } from "@/lib/pin";
import { useSession } from "@/providers/session-provider";
import { useI18n } from "@/providers/i18n-provider";

/**
 * Primera vez que se abre la aplicación. No hay nada que configurar fuera:
 * la base ya existe, solo falta saber quién manda.
 */
export function SetupScreen() {
  const { createFirstAdmin } = useSession();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length < 2) return setError(t("setup.nameRequired"));
    if (!isValidPin(pin)) return setError(t("setup.pinFormat"));
    if (pin !== repeat) return setError(t("setup.pinMismatch"));

    setBusy(true);
    const message = await createFirstAdmin(name, pin);
    setBusy(false);
    if (message) setError(message === "alreadySetUp" ? t("setup.already") : message);
  }

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-background px-6">
      <div className="w-full max-w-[21rem]">
        {/* El idioma se elige en Ajustes, no aquí: es una decisión que se toma
            una vez y no debe competir con la única acción de esta pantalla. */}
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {t("login.brand")}
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          {t("setup.title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("setup.subtitle")}
        </p>

        <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-name" className="text-xs">
              {t("users.fullName")}
            </Label>
            <Input
              id="setup-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="setup-pin" className="text-xs">
                {t("setup.pin")}
              </Label>
              <Input
                id="setup-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                placeholder="••••"
                value={pin}
                onChange={(e) =>
                  setPin(e.currentTarget.value.replace(/\D/g, "").slice(0, 8))
                }
                className="text-center font-mono text-lg tracking-[0.3em]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="setup-pin2" className="text-xs">
                {t("setup.pinRepeat")}
              </Label>
              <Input
                id="setup-pin2"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                placeholder="••••"
                value={repeat}
                onChange={(e) =>
                  setRepeat(e.currentTarget.value.replace(/\D/g, "").slice(0, 8))
                }
                className="text-center font-mono text-lg tracking-[0.3em]"
              />
            </div>
          </div>

          <Button type="submit" disabled={busy} className="mt-1 h-10 w-full">
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {t("setup.create")}
          </Button>

          <div className="min-h-8">
            {error ? (
              <div className="flex items-start gap-2 text-xs text-destructive">
                <CircleAlert className="mt-px size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
