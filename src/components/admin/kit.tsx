/**
 * Admin UI kit — small shared components so every admin page looks and
 * behaves consistently (Claymorphism + shadcn + Tailwind).
 */

import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
export { TableCell, TableHead, TableRow };
import { cn } from "@/lib/utils";

export function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="clay p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-extrabold tabular-nums">
        {value === null || value === undefined || value === ""
          ? "—"
          : String(value)}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AdminToolbar({
  search,
  onSearch,
  status,
  onStatus,
  children,
}: {
  search: string;
  onSearch: (v: string) => void;
  status?: "active" | "inactive" | "all";
  onStatus?: (v: "active" | "inactive" | "all") => void;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search…"
        className="clay-inset max-w-xs rounded-full px-4"
      />
      {status && onStatus && (
        <Select value={status} onValueChange={(v) => onStatus(v as never)}>
          <SelectTrigger className="w-36 rounded-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      )}
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={cn(
        "rounded-full",
        status === "active"
          ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
          : status === "completed"
            ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
            : "bg-[oklch(0.9_0.06_85)] text-[oklch(0.35_0.08_85)]",
      )}
    >
      {status}
    </Badge>
  );
}

export function ScoreBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  const color =
    pct >= 85
      ? "bg-[oklch(0.9_0.09_145)] text-[oklch(0.3_0.1_145)]"
      : pct >= 70
        ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
        : pct >= 50
          ? "bg-[oklch(0.9_0.06_85)] text-[oklch(0.35_0.08_85)]"
          : "bg-destructive text-white";
  return <Badge className={cn("rounded-full tabular-nums", color)}>{Math.round(pct)}%</Badge>;
}

/** Confirm + run a destructive/important action with toast feedback. */
export function useConfirmAction() {
  const [pending, setPending] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = (opts: {
    title: string;
    description: string;
    run: () => Promise<void>;
  }) => setPending(opts);

  const element = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(o) => !o && setPending(null)}
    >
      <AlertDialogContent className="clay border-0">
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="rounded-full">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="rounded-full"
            onClick={async (e) => {
              e.preventDefault();
              if (!pending) return;
              setBusy(true);
              try {
                await pending.run();
                setPending(null);
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Action failed",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, element };
}

export function DataTable({
  headers,
  children,
  empty,
  colSpan,
}: {
  headers: string[];
  children: ReactNode;
  empty: boolean;
  colSpan: number;
}) {
  return (
    <div className="clay overflow-x-auto p-2">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {empty ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="p-8 text-center text-muted-foreground">
                Nothing here yet.
              </TableCell>
            </TableRow>
          ) : (
            children
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {total} record{total === 1 ? "" : "s"} · page {page + 1} of {pages}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={page + 1 >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/** Download rows as CSV (client-side export for reports). */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null>>,
) {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${filename}`);
}
