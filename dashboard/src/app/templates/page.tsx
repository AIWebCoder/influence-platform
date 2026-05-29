"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

import { api } from "@/lib/api";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

type TemplateRow = {
  id: string;
  name: string;
  caption_template: string;
  visual_prompt?: string | null;
  is_active: boolean;
  niche_id?: string | null;
};

type NicheRow = { id: string; name: string };

export default function TemplatesPage() {
  const { text } = useLocale();
  const tpl = text.templatesPage;
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [niches, setNiches] = useState<NicheRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    caption_template: "",
    visual_prompt: "",
    niche_id: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tplList, nicheList] = await Promise.all([
        api.content.getTemplates(),
        api.content.getNiches(),
      ]);
      setTemplates(tplList);
      setNiches(nicheList);
    } catch {
      setError(tpl.loadError);
    } finally {
      setLoading(false);
    }
  }, [tpl.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const nicheName = (id: string | null | undefined) =>
    niches.find((n) => n.id === id)?.name ?? "—";

  const handleCreate = async () => {
    if (!form.name.trim() || !form.caption_template.trim()) return;
    setSaving(true);
    try {
      await api.content.createTemplate({
        name: form.name.trim(),
        caption_template: form.caption_template.trim(),
        visual_prompt: form.visual_prompt.trim() || undefined,
        niche_id: form.niche_id || undefined,
        is_active: true,
      });
      setDialogOpen(false);
      setForm({ name: "", caption_template: "", visual_prompt: "", niche_id: "" });
      await load();
    } catch {
      setError(tpl.createError);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(tpl.deleteConfirm)) return;
    try {
      await api.content.deleteTemplate(id);
      await load();
    } catch {
      setError(tpl.deleteError);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tpl.title}</h1>
          <p className="text-sm text-muted-foreground">{tpl.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            {tpl.new}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="size-5" />
            {tpl.list}
          </CardTitle>
          <CardDescription>{tpl.listHint}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tpl.name}</TableHead>
                  <TableHead>{tpl.niche}</TableHead>
                  <TableHead>{tpl.caption}</TableHead>
                  <TableHead>{tpl.active}</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      {tpl.empty}
                    </TableCell>
                  </TableRow>
                ) : (
                  templates.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{nicheName(row.niche_id)}</TableCell>
                      <TableCell className="max-w-md truncate">{row.caption_template}</TableCell>
                      <TableCell>
                        <Badge variant={row.is_active ? "default" : "secondary"}>
                          {row.is_active ? tpl.yes : tpl.no}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => void handleDelete(row.id)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tpl.dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{tpl.name}</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>{tpl.niche}</Label>
              <Select value={form.niche_id} onValueChange={(v) => setForm((f) => ({ ...f, niche_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder={tpl.optional} />
                </SelectTrigger>
                <SelectContent>
                  {niches.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tpl.captionTemplate}</Label>
              <textarea
                rows={3}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.caption_template}
                onChange={(e) => setForm((f) => ({ ...f, caption_template: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{tpl.visualPrompt}</Label>
              <textarea
                rows={2}
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.visual_prompt}
                onChange={(e) => setForm((f) => ({ ...f, visual_prompt: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tpl.cancel}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : tpl.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
