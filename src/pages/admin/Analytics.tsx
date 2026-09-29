import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AdminPageHeader, StatCard } from "@/components/admin/kit";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Analytics = {
  metrics: {
    averageScore: number | null;
    medianScore: number | null;
    passRate: number | null;
    completionRate: number | null;
    activeLearners: number;
    attempts: number;
  };
  charts: {
    trend: Array<{ month: string; avgScore: number; sessions: number }>;
    institutionComparison: Array<{ name: string; avgScore: number | null }>;
    centerComparison: Array<{ name: string; avgScore: number | null }>;
    distribution: Array<{ name: string; value: number }>;
    monthlyCompletions: Array<{ month: string; completed: number }>;
  };
};

const PIE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-5)",
];

export default function Analytics() {
  const data = useQuery(api.adminAnalytics.getSystemAnalytics) as
    | Analytics
    | undefined;

  if (data === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);

  return (
    <>
      <AdminPageHeader
        title="Global performance analytics"
        subtitle="System-wide monitoring and analysis — no rankings, by design"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Avg score" value={pct(data.metrics.averageScore)} />
        <StatCard label="Median score" value={pct(data.metrics.medianScore)} />
        <StatCard label="Pass rate" value={pct(data.metrics.passRate)} />
        <StatCard label="Completion rate" value={pct(data.metrics.completionRate)} />
        <StatCard label="Active learners" value={data.metrics.activeLearners} />
        <StatCard label="Attempts" value={data.metrics.attempts} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <ChartCard title="Overall performance trend">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.charts.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="avgScore" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Institution comparison (avg score)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.charts.institutionComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="avgScore" fill="var(--color-chart-2)" radius={8} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Teaching center performance">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.charts.centerComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="avgScore" fill="var(--color-chart-3)" radius={8} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Student performance distribution">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.charts.distribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" radius={8}>
                {data.charts.distribution.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Monthly assessment completions" wide>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.charts.monthlyCompletions}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="completed" fill="var(--color-chart-4)" radius={8} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </>
  );
}

function ChartCard({
  title,
  children,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cnCard(wide)}>
      <p className="mb-3 text-sm font-bold">{title}</p>
      <div className="h-64">{children}</div>
    </div>
  );
}

function cnCard(wide?: boolean) {
  return `clay p-5${wide ? " xl:col-span-2" : ""}`;
}
