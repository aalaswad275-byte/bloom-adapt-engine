import { useState } from "react";
import { useQuery } from "convex/react";
import { Loader2, ScrollText } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  AdminPageHeader,
  AdminToolbar,
  DataTable,
  StatCard,
  TableCell,
} from "@/components/admin/kit";

type AuditRow = {
  _id: string;
  action: string;
  actorEmail?: string;
  entity?: string;
  entityId?: string;
  previousValue?: string;
  newValue?: string;
  detail?: string;
  timestamp: number;
};

export default function AuditLogs() {
  const [search, setSearch] = useState("");
  const data = useQuery(api.adminAnalytics.listAuditLogs, {
    search: search || undefined,
    limit: 200,
  }) as AuditRow[] | undefined;

  if (data === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const rows = data;

  return (
    <>
      <AdminPageHeader
        title="Audit logs"
        subtitle="Every admin action with actor, entity, previous → new values"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Entries shown" value={rows.length} icon={<ScrollText className="size-4 text-primary" />} />
        <StatCard
          label="Creates"
          value={rows.filter((r) => r.action.includes("created")).length}
        />
        <StatCard
          label="Updates"
          value={rows.filter((r) => r.action.includes("updated")).length}
        />
        <StatCard
          label="Deletes"
          value={rows.filter((r) => r.action.includes("deleted")).length}
        />
      </div>

      <AdminToolbar search={search} onSearch={setSearch} />

      <DataTable
        headers={["When", "Actor", "Action", "Entity", "Previous → New"]}
        empty={rows.length === 0}
        colSpan={5}
      >
        {rows.map((r) => (
          <tr key={r._id} className="hover:bg-[var(--accent)]/40">
            <TableCell className="whitespace-nowrap text-xs">
              {new Date(r.timestamp).toLocaleString()}
            </TableCell>
            <TableCell className="text-xs">{r.actorEmail ?? "system"}</TableCell>
            <TableCell className="font-medium">{r.action}</TableCell>
            <TableCell className="text-xs">
              {r.entity ?? "—"}
              {r.entityId ? (
                <span className="block font-mono text-[10px] text-muted-foreground">
                  {r.entityId.slice(-8)}
                </span>
              ) : null}
            </TableCell>
            <TableCell className="max-w-72">
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {r.previousValue ? `${r.previousValue} → ` : ""}
                {r.newValue ?? r.detail ?? ""}
              </p>
            </TableCell>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
