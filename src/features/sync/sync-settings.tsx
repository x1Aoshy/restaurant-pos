import { useEffect, useState } from "react";
import { CircleCheck, CircleAlert, LoaderCircle, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { exec, queryOne } from "@/lib/db";
import { setEnabled } from "@/features/sync/sync-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n-provider";
import { useSync } from "@/providers/sync-provider";

interface Draft {
  url: string;
  anonKey: string;
  token: string;
}

export function SyncSettings() {
  const { t } = useI18n();
  const { status, pending, lastSyncAt, errorKey, deviceId, enabled, syncNow, reload } =
    useSync();

  const [draft, setDraft] = useState<Draft>({ url: "", anonKey: "", token: "" });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (dirty) return;
    void queryOne<Draft>(
      `SELECT server_url AS url, server_key AS anonKey, venue_token AS token
         FROM sync_context WHERE id = 1`,
    ).then((row) => {
      if (row) setDraft(row);
    });
  }, [dirty]);

  const set = (key: keyof Draft, value: string) => {
    setDirty(true);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await exec(
        `UPDATE sync_context
            SET server_url = $1, server_key = $2, venue_token = $3
          WHERE id = 1`,
        [draft.url.trim(), draft.anonKey.trim(), draft.token.trim()],
      );
      setDirty(false);
      await reload();
      toast.success(t("settings.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (on: boolean) => {
    try {
      // Por `setEnabled` y no por un UPDATE suelto: encender la primera vez
      // tiene que sembrar el buzón con lo que ya hay en la base, o el terminal
      // que se une arranca sin carta y sin personal.
      const seeded = await setEnabled(on);
      await reload();
      if (seeded > 0) toast.success(t("sync.seeded", { n: seeded }));
      if (on) void syncNow();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const complete = Boolean(draft.url && draft.anonKey && draft.token);

  return (
    <div className="max-w-2xl">
      <div className="raised divide-y divide-border rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0">
            <Label htmlFor="sy-on" className="text-[13px]">
              {t("sync.enable")}
            </Label>
          </div>
          <Switch
            id="sy-on"
            checked={enabled}
            disabled={!complete && !enabled}
            onCheckedChange={(v) => void toggle(v)}
          />
        </div>

        <div className="flex flex-col gap-2 px-4 py-3.5">
          <Label htmlFor="sy-url" className="text-[13px]">
            {t("sync.url")}
          </Label>
          <Input
            id="sy-url"
            value={draft.url}
            onChange={(e) => set("url", e.currentTarget.value)}
            placeholder="https://xxxxxxxx.supabase.co"
            className="font-mono text-xs"
          />
        </div>

        <div className="flex flex-col gap-2 px-4 py-3.5">
          <Label htmlFor="sy-key" className="text-[13px]">
            {t("sync.anonKey")}
          </Label>
          <Input
            id="sy-key"
            value={draft.anonKey}
            onChange={(e) => set("anonKey", e.currentTarget.value)}
            className="font-mono text-xs"
          />
        </div>

        <div className="flex flex-col gap-2 px-4 py-3.5">
          <Label htmlFor="sy-token" className="text-[13px]">
            {t("sync.venueToken")}
          </Label>
          <Input
            id="sy-token"
            type="password"
            autoComplete="off"
            value={draft.token}
            onChange={(e) => set("token", e.currentTarget.value)}
            className="font-mono text-xs"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
          {t("settings.save")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void syncNow()}
          disabled={!enabled || status === "syncing"}
        >
          <RefreshCw className={cn(status === "syncing" && "animate-spin")} />
          {t("sync.syncNow")}
        </Button>
      </div>

      {/* Estado real, sin adornos: cuántos cambios esperan y cuándo salió el
          último. Es lo único que responde a «¿se está guardando de verdad?». */}
      <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
        <div className="flex items-start gap-2.5">
          {status === "error" || status === "unconfigured" ? (
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-status-billed" />
          ) : (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-status-free" />
          )}
          <div className="min-w-0 text-xs leading-relaxed">
            <p className="font-medium tracking-tight">
              {status === "off"
                ? t("sync.stateOff")
                : status === "unconfigured"
                  ? t("sync.stateUnconfigured")
                  : status === "syncing"
                    ? t("sync.syncing")
                    : status === "error"
                      ? t(errorKey ?? "sync.errNetwork")
                      : t("sync.stateIdle")}
            </p>
            <p className="mt-1 text-muted-foreground">
              {t("sync.pending", { n: pending })}
              {lastSyncAt ? ` · ${t("sync.lastAt", { d: lastSyncAt })}` : ""}
            </p>
            {deviceId ? (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {t("sync.deviceId")}: {deviceId.slice(0, 12)}…
              </p>
            ) : null}
          </div>
        </div>
      </div>

    </div>
  );
}
