import { useQuery } from "convex/react";
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Loader2,
  LineChart,
  MoveRight,
  ScanFace,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { BLOOM_LABEL, BLOOM_LEVELS, type BloomLevel } from "@/lib/irt";
import { calculateEffectiveDifficulty, calculateItemInformation, calculateProbability } from "@/lib/irt/engine";
import { calculateTimeStrain as calcTimeStrainFn } from "@/lib/irt/timeStrain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type Assessment = {
  id: string;
  title: string;
  description: string | null;
  displayCount: number;
  poolSize: number;
  gamma: number;
  delta: number;
};

type TakeData = {
  submission: {
    id: string;
    startedAt: number;
    timerStartedAt: number | null;
    displayed: number;
  };
  assessment: Assessment;
  currentQuestion: {
    id: string;
    questionText: string;
    questionType: string;
    options: string[] | null;
    marks: number;
    bloomLevel: BloomLevel;
    expectedTimeSec: number;
  } | null;
  currentShownAt: number;
  bloomShown: Record<string, number>;
};

type BloomTheta = Record<BloomLevel, number>;
type BloomSe = Record<BloomLevel, number>;
type BloomCounts = Record<BloomLevel, number>;

function assertBloomLevel(level: string | BloomLevel): BloomLevel {
  if (typeof level === "string" && BLOOM_LEVELS.includes(level as BloomLevel)) {
    return level as BloomLevel;
  }
  throw new Error(`Unsupported Bloom level: ${level}`);
}

function bloomTone(level: BloomLevel): string {
  return `var(--color-chart-${String(BLOOM_LEVELS.indexOf(level) + 1)})`;
}

function formatT(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  const sign = rounded < 0 ? "−" : rounded > 0 ? "+" : "";
  return `${sign}${Math.abs(rounded).toFixed(3)}`;
}

function formatNumber(value: number, fractionDigits = 2): string {
  return Number(value.toFixed(fractionDigits)).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function profileCardTheme(level: BloomLevel, theta: number, se: number, count: number, answeredCorrect: number, total: number): React.ReactNode {
  const isTop = Math.abs(theta) >= 1.0;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-white/85 p-4 shadow-sm transition-shadow hover:shadow-md",
        isTop && "border-primary/20 ring-1 ring-primary/10",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {BLOOM_LABEL[level]}
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-foreground">
            θ {formatNumber(theta)}
          </p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide", bloomTone(level))}>
          {BLOOM_LABEL[level]}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("size-2 rounded-full", bloomTone(level))} />
          <span>SE {formatNumber(se)}</span>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>{answeredCorrect}/{total} correct</p>
          <p className="text-[10px] font-medium text-muted-foreground/70">{count} items presented</p>
        </div>
      </div>

      {isTop ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
          <div className="h-full w-[calc(50%+20px)] animate-[shimmy_3s_ease-in-out_infinite] rounded-full bg-[var(--color-chart-2)]" />
        </div>
      ) : (
        <Progress value={Math.min(100, (count / 6) * 100)} className="mt-3 h-1.5 w-full rounded-full" />
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

function NumericBadge({ value, unit = "", highlight }: { value: number | null | undefined; unit?: string; highlight?: boolean }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-xs font-medium text-muted-foreground">—</span>;
  }
  const display = highlight ? (
    <span className="font-bold text-foreground">{formatNumber(value)}</span>
  ) : (
    <span className="text-xs font-semibold tabular-nums">{formatNumber(value)}</span>
  );
  return unit ? (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold tabular-nums", highlight ? "text-xs text-foreground" : "text-xs text-muted-foreground")}>
      {display}
      <span className="font-normal text-muted-foreground/70">{unit}</span>
    </span>
  ) : (
    display
  );
}

function BloomTonalNote({ level }: { level: BloomLevel }) {
  const accents: Record<BloomLevel, string> = {
    remember: "text-[oklch(0.45_0.12_145)]",
    understand: "text-[oklch(0.55_0.14_160)]",
    apply: "text-[oklch(0.35_0.12_175)]",
    analyze: "text-[oklch(0.42_0.12_200)]",
    evaluate: "text-[oklch(0.55_0.14_280)]",
    create: "text-[oklch(0.5_0.13_340)]",
  };
  return <span className={cn("text-[11px] font-semibold uppercase tracking-wide", accents[level])}>{BLOOM_LABEL[level]}</span>;
}

function ThetaProgressionCard({ history }: { history: Array<{ step: number; theta: number; bloom: BloomLevel }> }) {
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
      points[h.bloom].push({ step: h.step, theta: h.theta });
    }
    return points;
  }, [history]);

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series.remember}>
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
              const d = payload[0].payload as { step: number; theta: number; bloom: BloomLevel };
              return (
                <div className="rounded-xl border bg-white/95 p-3 shadow-lg text-xs">
                  <p className="font-bold text-foreground">{BLOOM_LABEL[d.bloom]}</p>
                  <p className="text-[10px] text-muted-foreground">step {d.step}</p>
                  <p className="font-semibold text-foreground">θ {formatNumber(d.theta)}</p>
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
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BloomDistributionCard({
  exam,
  presentedCounts,
}: {
  exam: { bloomDistribution: BloomCounts };
  presentedCounts: BloomCounts;
}) {
  const rows = useMemo(() => {
    return BLOOM_LEVELS.map((level) => ({
      level,
      target: exam.bloomDistribution[level] ?? 0,
      presented: presentedCounts[level] ?? 0,
    }));
  }, [exam.bloomDistribution, presentedCounts]);

  const maxTarget = Math.max(1, ...rows.map((r) => r.target));
  const maxPresented = Math.max(1, ...rows.map((r) => r.presented));

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="level" tick={{ fontSize: 10 }} />
          <YAxis
            tick={{ fontSize: 10 }}
            unit=" questions"
            domain={[0, Math.max(maxTarget, maxPresented) * 1.15]}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as { level: BloomLevel; target: number; presented: number };
              return (
                <div className="rounded-xl border bg-white/95 p-3 shadow-lg text-xs">
                  <p className="font-bold text-foreground">{BLOOM_LABEL[d.level]}</p>
                  <p className="text-[10px] text-muted-foreground">targeted</p>
                  <p className="font-semibold text-foreground">{d.target}</p>
                  <p className="text-[10px] text-muted-foreground">presented</p>
                  <p className="font-semibold text-foreground">{d.presented}</p>
                </div>
              );
            }}
          />
          <Bar dataKey="target" fill="var(--color-chart-2)" radius={6} name="targeted" />
          <Bar dataKey="presented" fill="var(--primary)" radius={6} name="presented" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function AssessmentResults() {
  const { isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { submissionId } = useParams() as { submissionId: string };

  const data = useQuery(
    api.studentAssessments.getMyResult,
    isAuthenticated && submissionId
      ? { submissionId: submissionId as import("@/convex/_generated/dataModel").Id<"assessmentSubmissions"> }
      : "skip",
  ) as {
    assessment: { id: string; title: string; description: string | null };
    submittedAt: number | null;
    score: number;
    maxScore: number;
    items: Array<{
      questionText: string;
      type: string;
      yourAnswer: string;
      correctAnswer: string;
      correct: boolean;
      marks: number;
      questionId: string;
      questionType: string;
      answerTimeMs: number | null;
      expectedTimeSec: number;
      bloomTarget: BloomLevel;
      bloomActual: BloomLevel;
      itemParams: { a: number; b: number };
      responseTimeMs: number | null;
      validityFactor: number | null;
      thetaBefore: number;
      thetaAfter: number;
      standardError: number;
      bloomShown: BloomCounts;
      presentedCounts: BloomCounts;
    }> | null;
  } | null;

  const takeData = useQuery(
    api.studentAssessments.getTakeAssessment,
    isAuthenticated && submissionId
      ? { submissionId: submissionId as import("@/convex/_generated/dataModel").Id<"assessmentSubmissions"> }
      : "skip",
  ) as TakeData | undefined;

  const hasActual = Boolean(data?.items?.some((i) => i.bloomActual !== undefined));

  const calcOverall = useMemo(() => {
    if (!data) return { pct: 0, score: data?.score ?? 0, maxScore: data?.maxScore ?? 0 };
    return {
      pct: data.maxScore > 0 ? (data.score / data.maxScore) * 100 : 0,
      score: data.score,
      maxScore: data.maxScore,
    };
  }, [data]);

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
            to={`/auth?returnTo=${encodeURIComponent(`/assessment-result/${submissionId}`)}`}
            className="mt-5 inline-block"
          >
            <Button className="rounded-full">Sign in</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const profile = data.items?.reduce(
    (acc, item) => {
      if (!item.thetaBefore) return acc;
      const level = assertBloomLevel(item.bloomActual ?? item.bloomTarget);
      const current = acc.theta[level] ?? 0;
      const se = acc.se[level] ?? 0;
      const count = (acc.presented[level] ?? 0) + 1;
      const correct = (acc.correct[level] ?? 0) + (item.correct ? 1 : 0);
      acc.theta[level] = current;
      acc.se[level] = se;
      acc.presented[level] = count;
      acc.correct[level] = correct;
      return acc;
    },
    {
      theta: { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 } as BloomTheta,
      se: { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 } as BloomSe,
      presented: { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 } as BloomCounts,
      correct: { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 } as Record<BloomLevel, number>,
    },
  );

  const history = useMemo(() => {
    if (!data?.items?.length) return [];
    let theta = { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 };
    const result: Array<{ step: number; theta: BloomTheta; bloom: BloomLevel }> = [];
    for (let i = 0; i < data.items.length; i += 1) {
      const item = data.items[i];
      if (item.thetaBefore) {
        theta = { ...theta, ...item.thetaBefore };
      }
      const level = assertBloomLevel(item.bloomActual ?? item.bloomTarget);
      result.push({ step: i + 1, theta, bloom: level });
    }
    return result;
  }, [data?.items]);

  const signedStrain = (actualMs: number, expectedSec: number): number => {
    return calculateTimeStrain(calcTimeStrainFn(actualMs / 1000, expectedSec), { gamma: 0.35, delta: 0.25, T: 0, V: 0 });
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-8%] top-[4%] size-[320px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[10%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-8">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" className="clay-press rounded-full" onClick={() => navigate("/my-class")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <p className="text-sm font-bold leading-tight">{data.assessment.title}</p>
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
                {data.assessment.title}
              </h1>
              {data.assessment.description && (
                <p className="mt-1 text-sm text-muted-foreground">{data.assessment.description}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <span className="font-semibold text-foreground">
                  {calcOverall.score}/{calcOverall.maxScore} overall
                </span>
                <Progress value={calcOverall.pct} className="h-2.5 max-w-xs" />
                <span className={cn("font-bold tabular-nums", calcOverall.pct >= 50 ? "text-[oklch(0.45_0.12_145)]" : "text-destructive")}>
                  {Math.round(calcOverall.pct)}%
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="clay-inset rounded-full text-xs text-foreground">
                {data.score}/{data.maxScore} scored
              </Badge>
              {hasActual && (
                <Badge className="clay-inset rounded-full text-xs text-foreground">
                  Bloom updated per level
                </Badge>
              )}
              <Badge className="clay-inset rounded-full text-xs text-foreground">
                γ {takeData?.assessment.gamma ?? 0.35}
              </Badge>
              <Badge className="clay-inset rounded-full text-xs text-foreground">
                δ {takeData?.assessment.delta ?? 0.25}
              </Badge>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Overall score is shown separately from the six Bloom dimensions.</span>
            <span>On a first view, θ defaults to the adaptive starting value until the level is practiced.</span>
          </div>
        </div>
      </section>

      <div className="relative z-10 mx-auto mt-6 grid w-full max-w-6xl gap-6 px-6 pb-16 lg:grid-cols-2">
        {/* Six-dimensional Bloom ability profile */}
        <div className="space-y-4">
          <SectionTitle icon={<BrainCircuit className="size-4 text-primary" />} title="Six-dimensional Bloom profile" subtitle="MAP θ with standard error per level" />
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(profile.theta) as BloomLevel[]).map((level) =>
              profileCardTheme(level, profile.theta[level], profile.se[level], profile.presented[level], profile.correct[level], data.items?.length ?? 0),
            )}
          </div>
        </div>

        {/* Bloom profile radar + overall score */}
        <div className="flex flex-col justify-center gap-6">
          <SectionTitle icon={<BarChart3 className="size-4 text-primary" />} title="Bloom ability profile" subtitle="θ across all six levels" />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={BLOOM_LEVELS.map((level) => ({ level: BLOOM_LABEL[level], theta: profile.theta[level] }))}>
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
              Measured separately from the Bloom dimensions — the six θ values are ability estimates, not a raw percent.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="clay-inset p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Score</p>
                <p className="mt-1 text-4xl font-extrabold tabular-nums text-foreground">
                  {calcOverall.score}/{calcOverall.maxScore}
                </p>
                <p className={cn("mt-2 text-sm font-bold", calcOverall.pct >= 50 ? "text-[oklch(0.45_0.12_145)]" : "text-destructive")}>
                  {Math.round(calcOverall.pct)}%
                </p>
              </div>
              <div className="clay-inset p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Adaptive items</p>
                <p className="mt-1 text-4xl font-extrabold tabular-nums text-foreground">
                  {data.items?.length ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">{takeData?.assessment.displayCount ?? 0} displayed</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bloom distribution + question progress table */}
        <div className="space-y-6">
          <SectionTitle icon={<BarChart3 className="size-4 text-primary" />} title="Bloom target vs actual" subtitle="How the adaptive model distributed the selected items" />
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={BLOOM_LEVELS.map((level) => ({
                level: BLOOM_LABEL[level],
                target: takeData?.assessment?.displayCount ?? 0,
                actual: profile.presented[level],
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="level" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit=" items" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as { level: BloomLevel; target: number; actual: number };
                    return (
                      <div className="rounded-xl border bg-white/95 p-3 shadow-lg text-xs">
                        <p className="font-bold text-foreground">{BLOOM_LABEL[d.level]}</p>
                        <p className="text-[10px] text-muted-foreground">targeted</p>
                        <p className="font-semibold text-foreground">{d.target}</p>
                        <p className="text-[10px] text-muted-foreground">presented</p>
                        <p className="font-semibold text-foreground">{d.actual}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="target" fill="var(--color-chart-2)" radius={6} />
                <Bar dataKey="actual" fill="var(--primary)" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Progression table */}
        <div className="space-y-4 lg:col-span-3">
          <SectionTitle icon={<LineChart className="size-4 text-primary" />} title="Question-by-question progression" subtitle="θ before/after each item, with P, information, signed time strain, and validity" />
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
                    <th className="py-3 px-3 font-medium">Signed T</th>
                    <th className="py-3 px-3 font-medium">V</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items?.map((item, i) => {
                    const level = assertBloomLevel(item.bloomActual ?? item.bloomTarget);
                    const t = signedStrain(item.answerTimeMs ?? item.responseTimeMs ?? 0, item.expectedTimeSec);
                    return (
                      <tr key={item.questionId ?? i} className="border-b border-[var(--border)] font-mono tabular-nums">
                        <td className="py-3 pr-3 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="py-3 pr-3 font-medium text-foreground">{item.questionText}</td>
                        <td className="py-3 px-3">
                          <BloomTonalNote level={level} />
                          <span className="ml-2 text-[10px] font-medium text-muted-foreground">
                            {BLOOM_LABEL[item.bloomTarget]}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          {item.correct ? (
                            <CheckCircle2 className="size-4 shrink-0 text-[oklch(0.55_0.14_145)]" />
                          ) : (
                            <XCircle className="size-4 shrink-0 text-destructive" />
                          )}
                          <span className={cn("ml-2 text-xs font-semibold", item.correct ? "text-[oklch(0.55_0.14_145)]" : "text-destructive")}>
                            {item.correct ? "correct" : "incorrect"}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs font-semibold text-foreground">
                          <NumericBadge value={item.itemParams ? calculateProbability(profile.theta[level] ?? 0, item.itemParams.a, item.itemParams.b, { gamma: 0.35, delta: 0.25, T: 0, V: 0 }) : null} />
                        </td>
                        <td className="py-3 px-3 text-xs font-semibold text-foreground">
                          <NumericBadge value={item.itemParams ? calculateItemInformation(profile.theta[level] ?? 0, item.itemParams.a, item.itemParams ? calculateProbability(profile.theta[level] ?? 0, item.itemParams.a, item.itemParams.b, { gamma: 0.35, delta: 0.25, T: 0, V: 0 }) : 0) : null} />
                        </td>
                        <td className={cn("py-3 px-3 text-xs font-semibold tabular-nums", t < -0.1 ? "text-[oklch(0.5_0.13_145)]" : t > 0.1 ? "text-[oklch(0.5_0.13_280)]" : "text-muted-foreground")}>
                          <NumericBadge value={t} />
                        </td>
                        <td className="py-3 px-3 text-xs font-semibold tabular-nums text-muted-foreground">
                          <NumericBadge value={item.validityFactor ?? null} highlight />
                        </td>
                      </tr>
                    );
                  })}
                  {(!data.items || data.items.length === 0) && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
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
            <SectionTitle icon={<TrendingUp className="size-4 text-primary" />} title="θ progression" subtitle="How ability changed after each item, colored by Bloom level" />
            <ThetaProgressionCard history={history} />
          </div>

          <div className="space-y-4">
            <SectionTitle icon={<CheckCircle2 className="size-4 text-primary" />} title="Ability precision" subtitle="Standard error across Bloom levels" />
            <div className="grid gap-3">
              {(Object.keys(profile.se) as BloomLevel[]).map((level) => (
                <div key={level} className="clay-inset px-4 py-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">{BLOOM_LABEL[level]}</span>
                    <span className="tabular-nums text-xs font-bold text-foreground">{profile.se[level] > 0 ? `±${formatNumber(profile.se[level])}` : "—"}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-chart-1)]"
                      style={{ width: Math.min(100, (Math.max(0, profile.se[level]) + 2) * 20) + "%" } as React.CSSProperties}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              SE is the model's certainty around each θ estimate. Smaller values mean the level is better practiced.
            </p>
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6">
        <div className="clay p-6 text-center text-xs text-muted-foreground">
          {takeData?.assessment?.timeLimitMin ? `Time limit: ${takeData.assessment.timeLimitMin} minutes` : "Untimed assessment"}
          {" · "}
          {takeData?.assessment?.poolSize
            ? `Pool ${takeData.assessment.poolSize}, displayed ${takeData.assessment.displayCount}`
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
