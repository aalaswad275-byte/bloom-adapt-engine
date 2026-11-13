import { useQuery } from "convex/react";
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  LineChart,
  Loader2,
  ScanFace,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  BLOOM_LABEL,
  BLOOM_LEVELS,
  resolveBloomLabels,
  type BloomLevel,
} from "@/lib/irt";
import {
  calculateEffectiveDifficulty,
  calculateItemInformation,
  calculateProbability,
} from "@/lib/irt/engine";
import { calculateTimeStrain as calcTimeStrainFn } from "@/lib/irt/timeStrain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n";
import { localizedQuestionText } from "@/lib/localizedQuestion";
import { cn } from "@/lib/utils";

/**
 * Types returned by the new getAssessmentResult query (complete, server-side
 * shape for a finished submission). The client never receives rich
 * per-question params here; it receives the raw stored fields and reconstructs
 * every metric itself.
 */
type ServerAssessment = {
  id: Id<"instructorAssessments">;
  title: string;
  titleAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  timeLimitMin: number;
  adaptive: boolean;
  displayCount: number;
  poolSize: number;
  gamma: number;
  delta: number;
  /** Instructor's display names for the six Bloom levels. */
  bloomLabels: Record<string, string>;
};

type ServerSubmission = {
  id: Id<"assessmentSubmissions">;
  status: string;
  startedAt: number;
  submittedAt: number | null;
  score: number;
  maxScore: number;
  violationCount: number;
  policyAction: string;
  grade: string | null;
  passed: boolean | null;
  completionReason: string | null;
  weakestBloomAreas: BloomLevel[];
};

type ServerRow = {
  questionId: string;
  questionText: string;
  questionTextAr: string | null;
  type: string;
  bloomLevel: BloomLevel;
  expectedTimeSec: number;
  a: number;
  b: number;
  marks: number;
  correctAnswer: string;
  yourAnswer: string;
  correct: boolean;
  fraction?: number;
  responseTimeMs: number;
  validityFactor: number;
  thetaBefore: Record<BloomLevel, number>;
  thetaAfter: Record<BloomLevel, number>;
  standardError: Record<BloomLevel, number>;
  presented: Record<BloomLevel, number>;
};

/** Map of ability estimate (θ) per Bloom level. */
type BloomTheta = Record<BloomLevel, number>;

type ResultData = {
  assessment: ServerAssessment;
  submission: ServerSubmission;
  thetaProfile: Record<BloomLevel, number>;
  presentedByLevel: Record<BloomLevel, number>;
  rows: ServerRow[];
};

/**
 * Computation-heavy derived state. Everything here flows from the server's
 * raw stored fields (questions, answers, response times, validity factors,
 * theta profile) plus the fixed model constants γ = 0.35, δ = 0.25, so the
 * page is a faithful post-hoc reconstruction of the adaptive run.
 */
function useResultData(data: ResultData | null) {
  // ---- Six-dimensional Bloom profile (MAP θ per level) ----
  const profile = useMemo(() => {
    const theta: Record<BloomLevel, number> = {
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
    };
    const se: Record<BloomLevel, number> = {
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
    };
    const presented: Record<BloomLevel, number> = {
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
    };
    const correct: Record<BloomLevel, number> = {
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
    };
    const earnedMarks: Record<BloomLevel, number> = {
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
    };
    const maxMarks: Record<BloomLevel, number> = {
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
    };

    for (const row of data?.rows ?? []) {
      const level = row.bloomLevel;
      theta[level] = row.thetaAfter[level] ?? row.thetaBefore[level] ?? 0;
      se[level] = row.standardError[level] ?? 0;
      presented[level] = (presented[level] ?? 0) + 1;
      correct[level] = (correct[level] ?? 0) + (row.correct ? 1 : 0);
      earnedMarks[level] =
        (earnedMarks[level] ?? 0) +
        row.marks * (row.fraction ?? (row.correct ? 1 : 0));
      maxMarks[level] = (maxMarks[level] ?? 0) + row.marks;
    }

    return {
      theta,
      se,
      presented,
      correct,
      earnedMarks,
      maxMarks,
      totalItems: data?.rows.length ?? 0,
    };
  }, [data]);

  // ---- Overall score (separate from Bloom profile) ----
  const calcOverall = useMemo(() => {
    if (!data) return { pct: 0, score: 0, maxScore: 0 };
    return {
      pct: data.submission.maxScore > 0 ? (data.submission.score / data.submission.maxScore) * 100 : 0,
      score: data.submission.score,
      maxScore: data.submission.maxScore,
    };
  }, [data]);

  // ---- θ progression history (θ AFTER each item, colored by that item's Bloom level) ----
  const history = useMemo(() => {
    if (!data?.rows.length) return [];
    // Walk the sequence; thetaAfter is already the model's state after that item.
    const result: Array<{ step: number; theta: BloomTheta; bloom: BloomLevel }> = [];
    for (let i = 0; i < data.rows.length; i++) {
      const row = data.rows[i];
      result.push({
        step: i + 1,
        theta: row.thetaAfter as BloomTheta,
        bloom: row.bloomLevel,
      });
    }
    return result;
  }, [data]);

  // ---- Signed time strain T for each row ----
  const signedStrains = useMemo(() => {
    return data?.rows.map((row) => {
      const actualSec = row.responseTimeMs / 1000;
      const t = calcTimeStrainFn(actualSec, row.expectedTimeSec, {
        epsilon: 1e-6,
        clipLow: -1,
        clipHigh: 1,
        normalBand: 0.15,
      });
      return t;
    });
  }, [data]);

  // ---- P / ItemInformation for each row (θ at the level, a, b, gamma/delta/T/V) ----
  const perQuestion = useMemo(() => {
    if (!data?.rows.length) return [];
    return data.rows.map((row, i) => {
      const theta = profile.theta[row.bloomLevel] ?? 0;
      // Signed (never abs'd) strain for this exact response, matching the
      // "Signed T" column and the context the adaptive model graded it with.
      const t = signedStrains?.[i] ?? 0;
      const ctx = {
        gamma: data.assessment.gamma,
        delta: data.assessment.delta,
        T: t,
        V: row.validityFactor,
      };
      const prob = calculateProbability(theta, row.a, row.b, ctx);
      const info = calculateItemInformation(theta, row.a, prob);
      return {
        ...row,
        theta,
        probability: prob,
        itemInformation: info,
        bEff: calculateEffectiveDifficulty(row.b, ctx),
        t,
      };
    });
  }, [data, profile, signedStrains]);

  // ---- Bloom target vs actual distribution ----
  // "Target" is the adaptive selector's planning share: an even spread across
  // the six Bloom levels of the student's display quota. "Actual" is what the
  // selector actually presented (presentedByLevel from the model).
  const distribution = useMemo(() => {
    if (!data) return BLOOM_LEVELS.map((l) => ({ level: l, target: 0, actual: 0 }));
    const presented = data.presentedByLevel as Record<BloomLevel, number>;
    const targetCount = Math.round((data.rows.length / BLOOM_LEVELS.length) * 10) / 10;
    return BLOOM_LEVELS.map((level) => ({
      level,
      target: targetCount,
      actual: presented[level] ?? (data.rows ?? []).filter((r) => r.bloomLevel === level).length,
    }));
  }, [data]);

  return {
    profile,
    calcOverall,
    history,
    perQuestion,
    distribution,
    thetaProfile: data?.thetaProfile ?? {
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
    },
  };
}

function assertBloomLevel(level: string | BloomLevel): BloomLevel {
  if (typeof level === "string" && BLOOM_LEVELS.includes(level as BloomLevel)) {
    return level as BloomLevel;
  }
  throw new Error(`Unsupported Bloom level: ${level}`);
}

function bloomTone(level: BloomLevel): string {
  return `var(--color-chart-${String(BLOOM_LEVELS.indexOf(level) + 1)})`;
}

function formatNumber(value: number, fractionDigits = 2): string {
  return Number(value.toFixed(fractionDigits)).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}

function profileCardTheme(
  label: string,
  level: BloomLevel,
  theta: number,
  se: number,
  count: number,
  answeredCorrect: number,
  earnedMarks: number,
  maxMarks: number,
  isWeakest: boolean,
): React.ReactNode {
  const isTop = Math.abs(theta) >= 1.0;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-white/85 p-4 shadow-sm transition-shadow hover:shadow-md",
        isTop && "border-primary/20 ring-1 ring-primary/10",
        isWeakest && "border-destructive/40 ring-1 ring-destructive/20",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-foreground">
            θ {formatNumber(theta)}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
            bloomTone(level),
          )}
        >
          {label}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("size-2 rounded-full", bloomTone(level))} />
          <span>SE {formatNumber(se)}</span>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>{answeredCorrect}/{count} correct</p>
          <p className="text-[10px] font-medium text-muted-foreground/70">
            {earnedMarks}/{maxMarks} marks · {count} presented
          </p>
        </div>
      </div>

      {isTop ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
          <div className="h-full w-[calc(50%+20px)] animate-[shimmy_3s_ease-in-out_infinite] rounded-full bg-[var(--color-chart-2)]" />
        </div>
      ) : (
        <Progress
          value={Math.min(100, (count / 6) * 100)}
          className="mt-3 h-1.5 w-full rounded-full"
        />
      )}

      {isWeakest && (
        <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-destructive">
          Weakest Bloom area
        </p>
      )}

      {se > 0 && (
        <div className="pointer-events-none absolute -right-2 -top-2 size-6 rounded-full bg-white/90 shadow-sm ring-1 ring-black/5">
          <div className="flex h-full w-full items-center justify-center text-[9px] font-extrabold text-muted-foreground">
            ±{formatNumber(se)}
          </div>
        </div>
      )}
    </div>
  );
}

function NumericBadge({
  value,
  unit = "",
  highlight,
}: {
  value: number | null | undefined;
  unit?: string;
  highlight?: boolean;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-xs font-medium text-muted-foreground">—</span>;
  }
  const display = highlight ? (
    <span className="font-bold text-foreground">{formatNumber(value)}</span>
  ) : (
    <span className="text-xs font-semibold tabular-nums">{formatNumber(value)}</span>
  );
  return unit ? (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
        highlight ? "text-xs text-foreground" : "text-xs text-muted-foreground",
      )}
    >
      {display}
      <span className="font-normal text-muted-foreground/70">{unit}</span>
    </span>
  ) : (
    display
  );
}

function BloomTonalNote({
  level,
  label,
}: {
  level: BloomLevel;
  label: string;
}) {
  const accents: Record<BloomLevel, string> = {
    remember: "text-[oklch(0.45_0.12_145)]",
    understand: "text-[oklch(0.55_0.14_160)]",
    apply: "text-[oklch(0.35_0.12_175)]",
    analyze: "text-[oklch(0.42_0.12_200)]",
    evaluate: "text-[oklch(0.55_0.14_280)]",
    create: "text-[oklch(0.5_0.13_340)]",
  };
  return (
    <span
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wide",
        accents[level],
      )}
    >
      {label}
    </span>
  );
}

function ThetaProgressionCard({
  history,
  labels,
}: {
  history: Array<{ step: number; theta: BloomTheta; bloom: BloomLevel }>;
  labels: Record<string, string>;
}) {
  const series = useMemo(() => {
    const points: Record<BloomLevel, Array<{ step: number; theta: number }>> = {
      remember: [],
      understand: [],
      apply: [],
      analyze: [],
      evaluate: [],
      create: [],
    };
    for (const h of history) {
      // Plot the scalar θ for this item's own Bloom level, not the whole record.
      points[h.bloom].push({ step: h.step, theta: h.theta[h.bloom] ?? 0 });
    }
    return points;
  }, [history]);

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart data={series.remember}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="step" tick={{ fontSize: 10 }} />
          <YAxis
            tick={{ fontSize: 10 }}
            domain={[-3, 3]}
            ticks={[-3, -2, -1, 0, 1, 2, 3]}
            tickFormatter={(v) => formatNumber(v)}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as {
                step: number;
                theta: number;
                bloom: BloomLevel;
              };
              return (
                <div className="rounded-xl border bg-white/95 p-3 shadow-lg text-xs">
                  <p className="font-bold text-foreground">
                    {labels[d.bloom]}
                  </p>
                  <p className="text-[10px] text-muted-foreground">step {d.step}</p>
                  <p className="font-semibold text-foreground">
                    θ {formatNumber(d.theta)}
                  </p>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="theta"
            stroke={bloomTone("remember")}
            strokeWidth={2.5}
            dot={{ r: 3, fill: "white", strokeWidth: 1.5 }}
            activeDot={{ r: 5 }}
          />
          {BLOOM_LEVELS.slice(1).map((level) => (
            <Line
              key={level}
              type="monotone"
              dataKey="theta"
              stroke={bloomTone(level)}
              strokeWidth={2}
              dot={{ r: 2.5, fill: "white", strokeWidth: 1.5 }}
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BloomDistributionCard({
  data,
}: {
  data: Array<{ level: BloomLevel; target: number; actual: number }>;
}) {
  const rows = useMemo(() => data, [data]);

  const maxTarget = Math.max(1, ...rows.map((r) => r.target));
  const maxActual = Math.max(1, ...rows.map((r) => r.actual));

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="level" tick={{ fontSize: 10 }} />
          <YAxis
            tick={{ fontSize: 10 }}
            unit=" questions"
            domain={[0, Math.max(maxTarget, maxActual) * 1.15]}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as {
                level: BloomLevel;
                target: number;
                actual: number;
              };
              return (
                <div className="rounded-xl border bg-white/95 p-3 shadow-lg text-xs">
                  <p className="font-bold text-foreground">
                    {BLOOM_LABEL[d.level]}
                  </p>
                  <p className="text-[10px] text-muted-foreground">targeted</p>
                  <p className="font-semibold text-foreground">{d.target}</p>
                  <p className="text-[10px] text-muted-foreground">presented</p>
                  <p className="font-semibold text-foreground">{d.actual}</p>
                </div>
              );
            }}
          />
          <Bar dataKey="target" fill="var(--color-chart-2)" radius={6} name="targeted" />
          <Bar dataKey="actual" fill="var(--primary)" radius={6} name="presented" />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

const P_LINE_COLOR = "oklch(0.58 0.19 25)";
const INFO_LINE_COLOR = "oklch(0.5 0.13 145)";
const BEFF_LINE_COLOR = "oklch(0.5 0.13 280)";

/**
 * Per-question model diagnostics plotted against the question number:
 * P (predicted probability), Fisher item information, and the contextual
 * difficulty b_eff = b + γT + δV. The dashed guide marks P = 0.5, where
 * item information peaks — the adaptive selector's targeting point.
 */
function ProbabilityInformationCard({
  rows,
}: {
  rows: Array<{
    q: number;
    probability: number;
    itemInformation: number;
    bEff: number;
  }>;
}) {
  const yDomain = useMemo<[number, number]>(() => {
    if (!rows.length) return [-0.05, 1.55];
    const maxInfo = Math.max(...rows.map((r) => r.itemInformation));
    const maxBEff = Math.max(...rows.map((r) => r.bEff));
    const minBEff = Math.min(...rows.map((r) => r.bEff));
    return [
      Math.min(-0.05, minBEff - 0.1),
      Math.max(1, maxInfo * 1.1, maxBEff + 0.1),
    ];
  }, [rows]);

  return (
    <div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="q" tick={{ fontSize: 10 }} allowDecimals={false} />
            <YAxis
              tick={{ fontSize: 10 }}
              domain={yDomain}
              tickFormatter={(v) => formatNumber(v)}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as {
                  q: number;
                  probability: number;
                  itemInformation: number;
                  bEff: number;
                };
                return (
                  <div className="rounded-xl border bg-white/95 p-3 shadow-lg text-xs">
                    <p className="font-bold text-foreground">Question {d.q}</p>
                    <p
                      className="mt-1 font-semibold tabular-nums"
                      style={{ color: P_LINE_COLOR }}
                    >
                      P : {formatNumber(d.probability)}
                    </p>
                    <p
                      className="font-semibold tabular-nums"
                      style={{ color: INFO_LINE_COLOR }}
                    >
                      info : {formatNumber(d.itemInformation)}
                    </p>
                    <p
                      className="font-semibold tabular-nums"
                      style={{ color: BEFF_LINE_COLOR }}
                    >
                      bEff : {formatNumber(d.bEff)}
                    </p>
                  </div>
                );
              }}
            />
            <ReferenceLine
              y={0.5}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
            <Line
              type="monotone"
              dataKey="probability"
              stroke={P_LINE_COLOR}
              strokeWidth={2.5}
              dot={{ r: 3, fill: "white", strokeWidth: 1.5 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="itemInformation"
              stroke={INFO_LINE_COLOR}
              strokeWidth={2.5}
              dot={{ r: 3, fill: "white", strokeWidth: 1.5 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="bEff"
              stroke={BEFF_LINE_COLOR}
              strokeWidth={2.5}
              dot={{ r: 3, fill: "white", strokeWidth: 1.5 }}
              activeDot={{ r: 5 }}
            />
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] font-semibold text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: P_LINE_COLOR }}
          />{" "}
          P
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: INFO_LINE_COLOR }}
          />{" "}
          info
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: BEFF_LINE_COLOR }}
          />{" "}
          bEff
        </span>
      </div>
    </div>
  );
}

export default function AssessmentResults() {
  const { isLoading, isAuthenticated } = useAuth();
  const { language } = useI18n();
  const navigate = useNavigate();
  const { submissionId } = useParams() as { submissionId: string };

  const result = useQuery(
    api.studentAssessments.getAssessmentResult,
    isAuthenticated && submissionId
      ? {
          submissionId: submissionId as Id<"assessmentSubmissions">,
        }
      : "skip",
  ) as ResultData | null;

  const {
    profile,
    calcOverall,
    history,
    perQuestion,
    distribution,
    thetaProfile,
  } = useResultData(result);

  // Question-numbered series for the P / item information / b_eff chart.
  const probabilityRows = useMemo(
    () =>
      perQuestion.map((row, i) => ({
        q: i + 1,
        probability: row.probability,
        itemInformation: row.itemInformation,
        bEff: row.bEff,
      })),
    [perQuestion],
  );

  // Overall correct/incorrect counts and total response time.
  const counts = useMemo(() => {
    const rows = result?.rows ?? [];
    const correct = rows.filter((r) => r.correct).length;
    return {
      correct,
      incorrect: rows.length - correct,
      totalResponseMs: rows.reduce((sum, r) => sum + r.responseTimeMs, 0),
    };
  }, [result]);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-md p-8 text-center">
          <h1 className="text-xl font-bold">Sign in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This results page is only available to signed-in students.
          </p>
          <Link
            to={`/auth?returnTo=${encodeURIComponent(
              `/assessment-results/${submissionId}`,
            )}`}
            className="mt-5 inline-block"
          >
            <Button className="rounded-full">Sign in</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!result) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  /** The names the instructor chose for this assessment's Bloom levels. */
  const bloomLabels = resolveBloomLabels(result.assessment.bloomLabels);

  // Locked while the submission is still in progress so the grader never
  // settles on a half-built page.
  if (result.submission.status === "in_progress") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-8%] top-[4%] size-[320px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[10%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-8">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="clay-press rounded-full"
            onClick={() => navigate("/my-class")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <p className="text-sm font-bold leading-tight">
              {language === "ar"
                ? result.assessment.titleAr?.trim() || result.assessment.title
                : result.assessment.title}
            </p>
            <p className="text-xs text-muted-foreground">Assessment results</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="clay-inset rounded-full text-[10px] font-bold text-foreground">
            <BrainCircuit className="mr-1 size-3 text-primary" /> AdaptiveMind
          </Badge>
        </div>
      </header>

      <section className="relative z-10 mx-auto mt-8 w-full max-w-6xl px-6">
        <div className="clay p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">
                {language === "ar"
                  ? result.assessment.titleAr?.trim() || result.assessment.title
                  : result.assessment.title}
              </h1>
              {(language === "ar"
                ? result.assessment.descriptionAr?.trim() || result.assessment.description
                : result.assessment.description) && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {language === "ar"
                    ? result.assessment.descriptionAr?.trim() || result.assessment.description
                    : result.assessment.description}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <span className="font-semibold text-foreground">
                  {calcOverall.score}/{calcOverall.maxScore} overall
                </span>
                <Progress value={calcOverall.pct} className="h-2.5 max-w-xs" />
                <span
                  className={cn(
                    "font-bold tabular-nums",
                    calcOverall.pct >= 50
                      ? "text-[oklch(0.45_0.12_145)]"
                      : "text-destructive",
                  )}
                >
                  {Math.round(calcOverall.pct)}%
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="clay-inset rounded-full text-xs text-foreground">
                {result.submission.score}/{result.submission.maxScore} scored
              </Badge>
              <Badge className="clay-inset rounded-full text-xs text-foreground">
                γ {result.assessment.gamma}
              </Badge>
              <Badge className="clay-inset rounded-full text-xs text-foreground">
                δ {result.assessment.delta}
              </Badge>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="clay-inset p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Final grade
              </p>
              <p className="mt-1 text-4xl font-extrabold tabular-nums text-foreground">
                {result.submission.grade ?? "—"}
              </p>
              <p
                className={cn(
                  "mt-1 text-xs font-bold uppercase tracking-wide",
                  result.submission.passed === true
                    ? "text-[oklch(0.45_0.12_145)]"
                    : result.submission.passed === false
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {result.submission.passed === true
                  ? "Passed"
                  : result.submission.passed === false
                    ? "Not passed"
                    : "—"}
              </p>
              {result.submission.completionReason === "create_mastered" && (
                <p className="mt-1 text-[10px] font-semibold text-muted-foreground">
                  Create mastery — all required Create questions correct
                </p>
              )}
              {result.submission.completionReason === "create_exhausted" && (
                <p className="mt-1 text-[10px] font-semibold text-muted-foreground">
                  Create questions completed — graded fairly
                </p>
              )}
            </div>
            <div className="clay-inset p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Correct / incorrect
              </p>
              <p className="mt-1 text-4xl font-extrabold tabular-nums text-foreground">
                {counts.correct}
                <span className="text-muted-foreground">
                  {" "}
                  / {counts.incorrect}
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {(counts.totalResponseMs / 1000).toFixed(1)}s total response time
              </p>
            </div>
            <div className="clay-inset p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Weakest Bloom area
              </p>
              <p className="mt-1 text-lg font-extrabold text-foreground">
                {(result.submission.weakestBloomAreas ?? [])
                  .map((l) => bloomLabels[l])
                  .join(", ") || "—"}
              </p>
              <p className="mt-1 text-[10px] font-semibold text-muted-foreground">
                Lowest earned performance — never based on speed
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>
              Overall score is shown separately from the six Bloom dimensions.
            </span>
            <span>
              θ values are ability estimates (MAP), not a raw percent.
            </span>
          </div>
        </div>
      </section>

      <div className="relative z-10 mx-auto mt-6 grid w-full max-w-6xl gap-6 px-6 pb-16 lg:grid-cols-2">
        {/* Six-dimensional Bloom ability profile */}
        <div className="space-y-4">
          <SectionTitle
            icon={<BrainCircuit className="size-4 text-primary" />}
            title="Six-dimensional Bloom profile"
            subtitle="MAP θ with standard error per level"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(profile.theta) as BloomLevel[]).map((level) =>
              profileCardTheme(
                bloomLabels[level],
                level,
                profile.theta[level],
                profile.se[level],
                profile.presented[level],
                profile.correct[level],
                profile.earnedMarks[level],
                profile.maxMarks[level],
                (result.submission.weakestBloomAreas ?? []).includes(level),
              ),
            )}
          </div>
        </div>

        {/* Bloom profile radar + overall score */}
        <div className="flex flex-col justify-center gap-6">
          <SectionTitle
            icon={<BarChart3 className="size-4 text-primary" />}
            title="Bloom ability profile"
            subtitle="θ across all six levels"
          />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart
                data={BLOOM_LEVELS.map((level) => ({
                  level: bloomLabels[level],
                  theta: profile.theta[level],
                }))}
              >
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="level" tick={{ fontSize: 11 }} />
                <Radar
                  dataKey="theta"
                  stroke="var(--primary)"
                  fill="var(--primary)"
                  fillOpacity={0.3}
                />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="clay p-6">
            <h2 className="text-base font-bold">Overall assessment score</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Measured separately from the Bloom dimensions — the six θ values
              are ability estimates, not a raw percent.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="clay-inset p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Score
                </p>
                <p className="mt-1 text-4xl font-extrabold tabular-nums text-foreground">
                  {calcOverall.score}/{calcOverall.maxScore}
                </p>
                <p
                  className={cn(
                    "mt-2 text-sm font-bold",
                    calcOverall.pct >= 50
                      ? "text-[oklch(0.45_0.12_145)]"
                      : "text-destructive",
                  )}
                >
                  {Math.round(calcOverall.pct)}%
                </p>
              </div>
              <div className="clay-inset p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Adaptive items
                </p>
                <p className="mt-1 text-4xl font-extrabold tabular-nums text-foreground">
                  {profile.totalItems}
                </p>
                <p className="text-xs text-muted-foreground">
                  {result.assessment.displayCount} displayed · {counts.correct}{" "}
                  correct · {counts.incorrect} incorrect
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bloom distribution + question progress table */}
        <div className="space-y-6">
          <SectionTitle
            icon={<BarChart3 className="size-4 text-primary" />}
            title="Bloom target vs actual distribution"
            subtitle="How the adaptive model distributed the selected items"
          />
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="level" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit=" items" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as {
                      level: BloomLevel;
                      target: number;
                      actual: number;
                    };
                    return (
                      <div className="rounded-xl border bg-white/95 p-3 shadow-lg text-xs">
                        <p className="font-bold text-foreground">
                          {bloomLabels[d.level]}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          targeted
                        </p>
                        <p className="font-semibold text-foreground">
                          {d.target}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          presented
                        </p>
                        <p className="font-semibold text-foreground">
                          {d.actual}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="target" fill="var(--color-chart-2)" radius={6} />
                <Bar dataKey="actual" fill="var(--primary)" radius={6} />
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Predicted probability and item information per question */}
        <div className="space-y-8">
          <SectionTitle
            icon={<TrendingUp className="size-4 text-primary" />}
            title="Predicted probability P and item information"
            subtitle="Selection targets P ≈ 0.5 where information peaks"
          />
          <div className="clay p-4">
            <ProbabilityInformationCard rows={probabilityRows} />
          </div>
        </div>

        {/* Progression table */}
        <div className="space-y-4 lg:col-span-3">
          <SectionTitle
            icon={<LineChart className="size-4 text-primary" />}
            title="Question-by-question progression"
            subtitle="θ before/after each item, with P, information, signed time strain, and validity"
          />
          <div className="clay p-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="py-3 pr-3 font-medium">#</th>
                    <th className="py-3 px-3 font-medium">Question</th>
                    <th className="py-3 px-3 font-medium">Bloom</th>
                    <th className="py-3 px-3 font-medium">Result</th>
                    <th className="py-3 px-3 font-medium">P</th>
                    <th className="py-3 px-3 font-medium">Item Information</th>
                    <th className="py-3 px-3 font-medium">Time</th>
                    <th className="py-3 px-3 font-medium">Signed T</th>
                    <th className="py-3 px-3 font-medium">V</th>
                  </tr>
                </thead>
                <tbody>
                  {perQuestion.map((row, i) => {
                    const level = row.bloomLevel;
                    return (
                      <tr
                        key={row.questionId}
                        className="border-b border-[var(--border)] font-mono tabular-nums"
                      >
                        <td className="py-3 pr-3 text-xs text-muted-foreground">
                          {i + 1}
                        </td>
                        <td className="py-3 pr-3 font-medium text-foreground">
                          {localizedQuestionText(row, language)}
                        </td>
                        <td className="py-3 px-3">
                          <BloomTonalNote level={level} label={bloomLabels[level]} />
                        </td>
                        <td className="py-3 px-3">
                          {row.correct ? (
                            <CheckCircle2 className="size-4 shrink-0 text-[oklch(0.55_0.14_145)]" />
                          ) : (row.fraction ?? 0) > 0 ? (
                            <CheckCircle2 className="size-4 shrink-0 text-[oklch(0.6_0.12_85)]" />
                          ) : (
                            <XCircle className="size-4 shrink-0 text-destructive" />
                          )}
                          <span
                            className={cn(
                              "ml-2 text-xs font-semibold",
                              row.correct
                                ? "text-[oklch(0.55_0.14_145)]"
                                : (row.fraction ?? 0) > 0
                                  ? "text-[oklch(0.5_0.1_85)]"
                                  : "text-destructive",
                            )}
                          >
                            {row.correct
                              ? "correct"
                              : (row.fraction ?? 0) > 0
                                ? `partial (${Math.round((row.fraction ?? 0) * 100)}%)`
                                : "incorrect"}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs font-semibold text-foreground">
                          <NumericBadge value={row.probability} />
                        </td>
                        <td className="py-3 px-3 text-xs font-semibold text-foreground">
                          <NumericBadge value={row.itemInformation} />
                        </td>
                        <td className="py-3 px-3 text-xs font-semibold tabular-nums text-muted-foreground">
                          <NumericBadge value={row.responseTimeMs / 1000} unit="s" />
                        </td>
                        <td
                          className={cn(
                            "py-3 px-3 text-xs font-semibold tabular-nums",
                            row.t < -0.1
                              ? "text-[oklch(0.5_0.13_145)]"
                              : row.t > 0.1
                                ? "text-[oklch(0.5_0.13_280)]"
                                : "text-muted-foreground",
                          )}
                        >
                          <NumericBadge value={row.t} />
                        </td>
                        <td className="py-3 px-3 text-xs font-semibold tabular-nums text-muted-foreground">
                          <NumericBadge value={row.validityFactor} highlight />
                        </td>
                      </tr>
                    );
                  })}
                  {(!perQuestion || perQuestion.length === 0) && (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        No response history recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Theta progression chart + SE detail */}
        <div className="grid gap-6 lg:col-span-3 lg:grid-cols-2">
          <div className="space-y-4">
            <SectionTitle
              icon={<TrendingUp className="size-4 text-primary" />}
              title="θ progression"
              subtitle="How ability changed after each item, colored by Bloom level"
            />
            <ThetaProgressionCard history={history} labels={bloomLabels} />
          </div>

          <div className="space-y-4">
            <SectionTitle
              icon={<CheckCircle2 className="size-4 text-primary" />}
              title="Ability precision"
              subtitle="Standard error across Bloom levels"
            />
            <div className="grid gap-3">
              {(Object.keys(profile.se) as BloomLevel[]).map((level) => (
                <div key={level} className="clay-inset px-4 py-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">
                      {bloomLabels[level]}
                    </span>
                    <span className="tabular-nums text-xs font-bold text-foreground">
                      {profile.se[level] > 0 ? `±${formatNumber(profile.se[level])}` : "—"}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-chart-1)]"
                      style={{
                        width: Math.min(
                          100,
                          (Math.max(0, profile.se[level]) + 2) * 20,
                        ) + "%",
                      } as React.CSSProperties}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              SE is the model's certainty around each θ estimate. Smaller values
              mean the level is better practiced.
            </p>
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6">
        <div className="clay p-6 text-center text-xs text-muted-foreground">
          {result.assessment.timeLimitMin
            ? `Time limit: ${result.assessment.timeLimitMin} minutes`
            : "Untimed assessment"}
          {" · "}
          {result.assessment.poolSize
            ? `Pool ${result.assessment.poolSize}, displayed ${result.assessment.displayCount}`
            : ""}
        </div>
      </div>
    </main>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-bold">
        {icon}
        <span>{title}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
