import { useState } from "react";
import { LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/providers/i18n-provider";

/** Lo que la comprobación de Rust averiguó del fichero elegido. */
export interface RestoreCandidate {
  path: string;
  version: number;
  bytes: number;
}

/**
 * Confirmación de una restauración.
 *
 * Es la única acción de la aplicación que borra trabajo ya hecho: todo lo
 * cobrado después de esa copia desaparece. Por eso no basta con un «¿seguro?»,
 * que a la tercera vez se pulsa sin leer — hay que **escribir** la palabra.
 *
 * El fichero ya viene comprobado: si llegamos aquí, se abrió, pasó el chequeo de
 * integridad y tiene las tablas de esta aplicación. Lo que queda por decidir no
 * es técnico, es si de verdad se quiere perder lo de en medio.
 */
export function RestoreDialog({
  file,
  onClose,
  onConfirm,
}: {
  file: RestoreCandidate | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const word = t("bk.restoreWord");
  const armed = typed.trim().toUpperCase() === word.toUpperCase();

  const close = () => {
    setTyped("");
    onClose();
  };

  const confirm = async () => {
    if (!armed) return;
    setBusy(true);
    await onConfirm();
    setBusy(false);
  };

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-destructive" />
            {t("bk.restore")}
          </DialogTitle>
          <DialogDescription>{t("bk.restoreWarn")}</DialogDescription>
        </DialogHeader>

        {file ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {file.path}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
              {t("bk.restoreMeta", {
                mb: (file.bytes / 1048576).toFixed(1),
                v: String(file.version),
              })}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="rs-word" className="text-xs text-muted-foreground">
            {t("bk.restoreType", { w: word })}
          </label>
          <Input
            id="rs-word"
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && armed && void confirm()}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={!armed || busy}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
            {t("bk.restoreDo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
