import { useCallback, useEffect, useState } from "react";
import { KeyRound, LoaderCircle, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exec, newId, query } from "@/lib/db";
import { hashPin, isValidPin } from "@/lib/pin";
import { useI18n } from "@/providers/i18n-provider";
import { useSession } from "@/providers/session-provider";
import type { StaffPublic, StaffRole } from "@/types/local";

const ROLES: StaffRole[] = ["admin", "manager", "waiter", "cashier"];

const EMPTY = { name: "", pin: "", role: "waiter" as StaffRole };

export function UsersRoute() {
  const { t } = useI18n();
  const { staff: me, refreshRoster } = useSession();
  const roleLabel = (r: StaffRole) => t(`role.${r}`);

  const [rows, setRows] = useState<StaffPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  // Reiniciar el PIN de alguien que lo olvidó, sin borrar su cuenta ni su
  // historial de comandas.
  const [pinFor, setPinFor] = useState<StaffPublic | null>(null);
  const [newPin, setNewPin] = useState("");

  const load = useCallback(async () => {
    setRows(
      await query<StaffPublic>(
        "SELECT id, full_name, role, active, created_at FROM staff ORDER BY created_at",
      ),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createStaff = async () => {
    const name = draft.name.trim();
    if (name.length < 2) return toast.error(t("setup.nameRequired"));
    if (!isValidPin(draft.pin)) return toast.error(t("setup.pinFormat"));

    setSaving(true);
    try {
      await exec(
        `INSERT INTO staff (id, full_name, role, pin_hash, active)
         VALUES ($1, $2, $3, $4, 1)`,
        [newId(), name, draft.role, await hashPin(draft.pin)],
      );
      toast.success(t("toast.accountCreated", { n: name }));
      setCreateOpen(false);
      setDraft(EMPTY);
      await load();
      await refreshRoster();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const resetPin = async () => {
    if (!pinFor) return;
    if (!isValidPin(newPin)) return toast.error(t("setup.pinFormat"));

    setSaving(true);
    try {
      await exec("UPDATE staff SET pin_hash = $1 WHERE id = $2", [
        await hashPin(newPin),
        pinFor.id,
      ]);
      toast.success(t("users.pinReset", { n: pinFor.full_name }));
      setPinFor(null);
      setNewPin("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (person: StaffPublic, role: StaffRole) => {
    setRows((prev) => prev.map((r) => (r.id === person.id ? { ...r, role } : r)));
    try {
      await exec("UPDATE staff SET role = $1 WHERE id = $2", [role, person.id]);
      toast.success(`${person.full_name} · ${roleLabel(role)}`);
      await refreshRoster();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      await load();
    }
  };

  const toggleActive = async (person: StaffPublic) => {
    const next = person.active ? 0 : 1;
    setRows((prev) =>
      prev.map((r) => (r.id === person.id ? { ...r, active: next } : r)),
    );
    try {
      await exec("UPDATE staff SET active = $1 WHERE id = $2", [next, person.id]);
      await refreshRoster();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      await load();
    }
  };

  return (
    <>
      <PageHeader
        title={t("users.title")}
        description={t("users.count", { n: rows.length })}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <UserPlus />
            {t("users.new")}
          </Button>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {loading ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : (
            <div className="raised rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("products.name")}</TableHead>
                    <TableHead className="w-52">{t("users.role")}</TableHead>
                    <TableHead className="w-24 text-center">
                      {t("users.active")}
                    </TableHead>
                    <TableHead className="w-32">{t("users.since")}</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((person) => {
                    const isSelf = person.id === me?.id;
                    return (
                      <TableRow key={person.id}>
                        <TableCell className="font-medium tracking-tight">
                          {person.full_name}
                          {isSelf ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {t("users.you")}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={person.role}
                            onValueChange={(v: string | null) => {
                              if (v) void changeRole(person, v as StaffRole);
                            }}
                            disabled={isSelf}
                          >
                            <SelectTrigger size="sm" className="w-44">
                              <SelectValue>
                                {(v: string) => roleLabel(v as StaffRole)}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {roleLabel(r)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={person.active === 1}
                            disabled={isSelf}
                            onCheckedChange={() => void toggleActive(person)}
                            aria-label={t("users.active")}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                          {person.created_at.slice(0, 10)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t("users.resetPin")}
                            aria-label={t("users.resetPin")}
                            onClick={() => {
                              setNewPin("");
                              setPinFor(person);
                            }}
                          >
                            <KeyRound />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </ScrollArea>

      <Dialog open={createOpen} onOpenChange={(o) => !o && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("users.new")}</DialogTitle>
            <DialogDescription>{t("users.newDescLocal")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="u-name">{t("users.fullName")}</Label>
              <Input
                id="u-name"
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="u-role">{t("users.role")}</Label>
              <Select
                value={draft.role}
                onValueChange={(v: string | null) => {
                  if (v) setDraft({ ...draft, role: v as StaffRole });
                }}
              >
                <SelectTrigger id="u-role" className="w-full">
                  <SelectValue>
                    {(v: string) => roleLabel(v as StaffRole)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="u-pin">{t("setup.pin")}</Label>
              <Input
                id="u-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                placeholder="••••"
                value={draft.pin}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    pin: e.currentTarget.value.replace(/\D/g, "").slice(0, 8),
                  })
                }
                className="text-center font-mono text-lg tracking-[0.3em]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void createStaff()} disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : null}
              {t("users.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pinFor !== null} onOpenChange={(o) => !o && setPinFor(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{t("users.resetPin")}</DialogTitle>
            <DialogDescription>{pinFor?.full_name}</DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Label htmlFor="u-newpin">{t("users.newPin")}</Label>
            <Input
              id="u-newpin"
              autoFocus
              type="password"
              inputMode="numeric"
              placeholder="••••"
              value={newPin}
              onChange={(e) =>
                setNewPin(e.currentTarget.value.replace(/\D/g, "").slice(0, 8))
              }
              className="mt-2 text-center font-mono text-lg tracking-[0.3em]"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPinFor(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void resetPin()} disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
