import { useQuery } from "convex/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { api } from "@/convex/_generated/api";
import { BLOOM_LABEL, BLOOM_LEVELS, type BloomLevel } from "@/lib/irt";
import {
  AlertTriangle,
  BrainCircuit,
  ChevronDown,
  Download,
  FlaskConical,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Link, useParams } from "react-router";
import {
  Bar,
  BarChart,
  CartesianAxis,
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ResultsData = {
  session: {
    _id: string;
    status: string;
    terminationReason: string | null;
    startedAt: number;
    completedAt: number | null;
    stepCount: number;
    correctCount: number;
    totalResponseTimeMs: number;
  };
  exam: {
    _id: string;
    title: string;
    totalQuestions: number;
    bloomDistribution: Record<BloomLevel, number>;
    gamma: number;
    delta: number;
    violationThreshold: number;
  };
  finalProfile: {
    theta: Record<BloomLevel, number>;
    standardErrors: Record<BloomLevel, number>;
    mastery: Record<BloomLevel, number>;
    attempted: Record<BloomLevel, number>;
  };
  adaptiveHistory: Array<{
    stepNumber: number;
    questionText: string;
    questionType: string | null;
    bloomLevel: BloomLevel;
    nextBloom: string | null;
    response: string;
    correctness: number;
    actualResponseTime: number;
    expectedTime: number;
    T: number;
    V: number;
    a: number;
    b: number;
    bNext: string | null;
    effectiveDifficulty: number;
    predictedProbability: number;
    itemInformation: number;
    behavioralSignal: string;
    adaptiveAction: string;
    difficultyChange: string;
    bloomTransition: string;
    selectionScore: string | null;
    candidates: Array<{
      questionId: string;
      utility: number;
      probability: number;
      information: number;
      bloomLevel: BloomLevel;
      eligible: boolean;
      reason?: string;
    }> | null;
    thetaBefore: number;
    thetaAfter: number;
    standardError: number;
    explanation: string | null;
    correctAnswer: string | null;
    marks: number;
  }>;
  integrity: {
    riskScore: number;
    confirmedViolations: number;
    events: Array<{
      timestamp: number;
      type: string;
      confidence: number;
      severity: string;
      detail: string | null;
    }>;
    incidents: Array<{ type: string; confirmedAt: number; evidenceCount: number }>;
    warnings: Array<{ timestamp: number; message: string; severity: string }>;
  };
};

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="clay p-6">
      <h2 className="text-base font-bold">{title}</h2>
      {subtitle && (
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      )}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function bloomColor(level: BloomLevel): string {
  const colors: Record<BloomLevel, string> = {
    remember: "var(--color-chart-1)",
    understand: "var(--color-chart-2)",
    apply: "var(--color-chart-3)",
    analyze: "var(--color-chart-4)",
    evaluate: "var(--color-chart-5)",
    create: "var(--color-chart-1)",
  };
  return colors[level];
}

// Question types graded by a human in v1 — they store correctness 1 as a
// placeholder, so the review labels them "manual review" instead of correct.
const MANUAL_GRADED = new Set(["essay", "programming", "case_study", "diagram"]);

export default function Results() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const data = useQuery(api.adaptive.getSessionResults, {
    sessionId,
  } as never) as ResultsData | undefined;

  if (data === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }
  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-md p-8 text-center text-sm">
          Session not found.
        </div>
      </main>
    );
  }

  const history = data.adaptiveHistory;
  // Skipped items (correctness === -1) carry no evidence: they are excluded
  // from accuracy and averaged metrics but stay visible in the research log.
  const answered = history.filter((h) => h.correctness >= 0);
  const skippedCount = history.length - answered.length;
  const accuracy =
    answered.length > 0
      ? data.session.correctCount / answered.length
      : 0;
  const avgStrain =
    answered.length > 0
      ? answered.reduce((acc, h) => acc + h.T, 0) / answered.length
      : 0;
  const avgV =
    answered.length > 0
      ? answered.reduce((acc, h) => acc + h.V, 0) / answered.length
      : 0;

  const thetaSeries = history
    .filter((h) => h.correctness >= 0)
    .map((h) => ({
      step: h.stepNumber + 1,
      theta: Number(h.thetaAfter.toFixed(2)),
      bloom: h.bloomLevel,
    }));
  const strainSeries = answered.map((h) => ({
    step: h.stepNumber + 1,
    T: Number(h.T.toFixed(2)),
    V: Number(h.V.toFixed(2)),
  }));
  const probSeries = answered.map((h) => ({
    step: h.stepNumber + 1,
    P: Number(h.predictedProbability.toFixed(2)),
    info: Number(h.itemInformation.toFixed(2)),
    bEff: Number(h.effectiveDifficulty.toFixed(2)),
  }));
  const answeredTotal = answered.length;
  const distribution = BLOOM_LEVELS.map((l) => ({
    level: BLOOM_LABEL[l],
    target: Math.round(data.exam.bloomDistribution[l] * 100),
    actual:
      answeredTotal > 0
        ? Math.round((data.finalProfile.attempted[l] / answeredTotal) * 100)
        : 0,
  }));

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adaptive-session-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const radarData = BLOOM_LEVELS.map((l) => ({
    level: BLOOM_LABEL[l],
    theta: Number(data.finalProfile.theta[l].toFixed(2)),
  }));

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-8%] top-[5%] size-[320px] bg-[oklch(0.85_0.09_320)]" />

      <header className="relative z-10 mx-auto w-full max-w-6xl px-6 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/dashboard" className="flex items-center gap-3">
            <div className="clay-sm flex size-10 items-center justify-center">
              <BrainCircuit className="size-5 text-primary" />
            </div>
            <span className="font-bold tracking-tight">AdaptiveMind</span>
          </Link>
          <Button
            variant="outline"
            className="clay-press rounded-full"
            onClick={exportJson}
          >
            <Download className="mr-2 size-4" /> Export research JSON
          </Button>
        </div>
      </header>

      <section className="relative z-10 mx-auto mt-8 w-full max-w-6xl px-6">
        <div className="clay p-7 sm:p-9">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">
                {data.exam.title}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.session.status === "terminated"
                  ? "Terminated by integrity engine — partial results below."
                  : "Assessment complete — full research report below."}
              </p>
            </div>
            <div className="flex gap-2">
              <Badge className="clay-inset rounded-full text-foreground">
                {data.session.correctCount}/{answered.length} correct (
                {Math.round(accuracy * 100)}%)
              </Badge>
              {skippedCount > 0 && (
                <Badge className="clay-inset rounded-full text-foreground">
                  {skippedCount} skipped
                </Badge>
              )}
              <Badge className="clay-inset rounded-full text-foreground">
                avg strain {avgStrain.toFixed(2)}
              </Badge>
              <Badge className="clay-inset rounded-full text-foreground">
                avg V {avgV.toFixed(2)}
              </Badge>
            </div>
          </div>

          {data.session.terminationReason === "violation_threshold" && (
            <div className="clay-inset mt-5 flex items-center gap-2 p-4 text-sm text-destructive">
              <AlertTriangle className="size-4" />
              The {data.exam.violationThreshold}-violation threshold was
              reached; monitoring evidence is preserved in the integrity
              report.
            </div>
          )}
        </div>
      </section>

      {/* Full questions & answers review — everything revealed at session end */}
      <section className="relative z-10 mx-auto mt-6 w-full max-w-6xl px-6">
        <SectionCard
          title="All questions & answers"
          subtitle={`Complete review of every item served this session — ${history.length} question${history.length === 1 ? "" : "s"}`}
        >
          <div className="space-y-4">
            {history.map((h) => {
              const manual =
                h.questionType !== null && MANUAL_GRADED.has(h.questionType);
              const status =
                h.correctness < 0
                  ? "skipped"
                  : manual
                    ? "manual"
                    : h.correctness === 1
                      ? "correct"
                      : "incorrect";
              return (
                <div key={h.stepNumber} className="clay-inset p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold">
                        Q{h.stepNumber + 1}
                      </span>
                      <Badge className="clay-inset rounded-full text-xs text-foreground">
                        {BLOOM_LABEL[h.bloomLevel]}
                      </Badge>
                      {status === "correct" && (
                        <Badge className="rounded-full bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]">
                          correct
                        </Badge>
                      )}
                      {status === "incorrect" && (
                        <Badge className="rounded-full bg-destructive text-white">
                          incorrect
                        </Badge>
                      )}
                      {status === "manual" && (
                        <Badge className="rounded-full bg-[oklch(0.9_0.07_85)] text-[oklch(0.35_0.08_85)]">
                          manual review
                        </Badge>
                      )}
                      {status === "skipped" && (
                        <Badge className="clay-inset rounded-full text-xs text-foreground">
                          skipped
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(h.actualResponseTime / 1000)}s of{" "}
                      {Math.round(h.expectedTime / 1000)}s expected
                    </span>
                  </div>

                  <p className="mt-3 whitespace-pre-line text-sm font-medium leading-relaxed">
                    {h.questionText}
                  </p>

                  <div className="mt-4 space-y-1.5 text-sm">
                    <p>
                      <span className="font-semibold">Your answer:</span>{" "}
                      {h.correctness < 0 ? (
                        <span className="text-muted-foreground">
                          skipped — no evidence recorded
                        </span>
                      ) : (
                        <span className="whitespace-pre-line">{h.response}</span>
                      )}
                    </p>
                    {h.correctAnswer !== null && (
                      <p>
                        <span className="font-semibold">Correct answer:</span>{" "}
                        <span className="whitespace-pre-line">
                          {h.correctAnswer}
                        </span>
                      </p>
                    )}
                    {h.explanation && (
                      <p className="text-muted-foreground">{h.explanation}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </section>

      <div className="relative z-10 mx-auto mt-6 grid w-full max-w-6xl gap-6 px-6 pb-16 lg:grid-cols-2">
        {/* Final Bloom profile */}
        <SectionCard
          title="Final six-dimensional Bloom profile"
          subtitle="MAP ability estimate θ per level with standard errors"
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="level" tick={{ fontSize: 11 }} />
                <Radar
                  dataKey="theta"
                  stroke="var(--primary)"
                  fill="var(--primary)"
                  fillOpacity={0.35}
                />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {BLOOM_LEVELS.map((l) => (
              <div key={l} className="clay-inset px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {BLOOM_LABEL[l]}
                </p>
                <p className="text-sm font-bold tabular-nums">
                  θ {data.finalProfile.theta[l].toFixed(2)}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    ±{data.finalProfile.standardErrors[l].toFixed(2)}
                  </span>
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {data.finalProfile.attempted[l]} items ·{" "}
                  {Math.round(data.finalProfile.mastery[l] * 100)}% mastery
                </p>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Distribution compliance */}
        <SectionCard
          title="Bloom target vs actual distribution"
          subtitle="The selector satisfies instructor-configured quotas with mandatory minimums"
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="level" tick={{ fontSize: 10 }} />
                <YAxis unit="%" tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="target" fill="var(--color-chart-2)" radius={8} />
                <Bar dataKey="actual" fill="var(--primary)" radius={8} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Adaptive selection balances IRT information against the
            instructor's Bloom blueprint; mandatory minimums are never
            violated while eligible items remain.
          </p>
        </SectionCard>

        {/* Theta progression */}
        <SectionCard
          title="θ progression per step"
          subtitle="Ability update after each item, colored by Bloom level"
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={thetaSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="step" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[-3, 3]} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="theta"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  dot={{ r: 3.5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* Strain + V */}
        <SectionCard
          title="Signed time strain T and visual mismatch V"
          subtitle={`γ=${data.exam.gamma} · δ=${data.exam.delta} — sign of T is preserved`}
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={strainSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="step" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[-1.2, 1.2]} />
                <Tooltip />
                <Line type="monotone" dataKey="T" stroke="var(--color-chart-2)" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="V" stroke="var(--color-chart-4)" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            T &lt; 0 faster than expected (P↑), T &gt; 0 slower (P↓); V ∈
            [0,1] inflates effective difficulty through δ·V.
          </p>
        </SectionCard>

        {/* P and information */}
        <SectionCard
          title="Predicted probability P and item information"
          subtitle="Selection targets P ≈ 0.5 where information peaks"
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={probSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="step" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 1]} />
                <Tooltip />
                <Line type="monotone" dataKey="P" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="info" stroke="var(--color-chart-3)" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="bEff" stroke="var(--color-chart-5)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* Integrity report */}
        <SectionCard
          title="Academic integrity report"
          subtitle="Independent subsystem — aggregated evidence only, never raw single detections"
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="clay-inset p-3 text-center">
              <p className="text-lg font-bold tabular-nums">
                {data.integrity.confirmedViolations}
              </p>
              <p className="text-[10px] text-muted-foreground">
                confirmed violations
              </p>
            </div>
            <div className="clay-inset p-3 text-center">
              <p className="text-lg font-bold tabular-nums">
                {data.integrity.riskScore.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground">risk score</p>
            </div>
            <div className="clay-inset p-3 text-center">
              <p className="text-lg font-bold tabular-nums">
                {data.integrity.events.length}
              </p>
              <p className="text-[10px] text-muted-foreground">raw events</p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {data.integrity.incidents.length === 0 &&
              data.integrity.events.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No integrity events recorded — clean session.
                </p>
              )}
            {data.integrity.incidents.map((i) => (
              <div
                key={i.type}
                className="clay-inset flex items-center justify-between p-3 text-sm"
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-destructive" />
                  {i.type.replace(/_/g, " ").toLowerCase()} (confirmed)
                </span>
                <span className="text-xs text-muted-foreground">
                  {i.evidenceCount} evidence events
                </span>
              </div>
            ))}
            {data.integrity.events.slice(0, 8).map((e, idx) => (
              <div
                key={`${e.timestamp}-${idx}`}
                className="flex items-center justify-between text-xs text-muted-foreground"
              >
                <span>{e.type.replace(/_/g, " ").toLowerCase()}</span>
                <span>
                  conf {e.confidence.toFixed(2)} ·{" "}
                  {new Date(e.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Adaptive trace table */}
        <div className="lg:col-span-2">
          <Collapsible>
            <div className="clay p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-bold">
                    <FlaskConical className="size-4 text-primary" />
                    Adaptive decision log (research)
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Every step records θ before/after, a, b, T, V, P,
                    information, behavioral case, transitions, and the ranked
                    candidate set — full reproducibility.
                  </p>
                </div>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="clay-press rounded-full">
                    Toggle log <ChevronDown className="ml-2 size-4" />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="mt-5 space-y-3">
                  {history.map((h) => (
                    <details
                      key={h.stepNumber}
                      className="clay-inset group p-4"
                    >
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                        <span>
                          Step {h.stepNumber + 1} · {BLOOM_LABEL[h.bloomLevel]}{" "}
                          ·{" "}
                          {h.correctness < 0 ? (
                            <span className="text-muted-foreground">skipped</span>
                          ) : h.correctness ? (
                            <span className="text-[oklch(0.55_0.14_145)]">
                              correct
                            </span>
                          ) : (
                            <span className="text-destructive">incorrect</span>
                          )}{" "}
                          · {h.behavioralSignal.replace(/_/g, " ").toLowerCase()}
                        </span>
                        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                        <div className="space-y-1 font-mono tabular-nums">
                          <div className="flex justify-between"><span>θ</span><span>{h.thetaBefore.toFixed(2)} → {h.thetaAfter.toFixed(2)} (±{h.standardError.toFixed(2)})</span></div>
                          <div className="flex justify-between"><span>a / b</span><span>{h.a.toFixed(2)} / {h.b.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span>T / V</span><span>{h.T.toFixed(3)} / {h.V.toFixed(3)}</span></div>
                          <div className="flex justify-between"><span>b_eff</span><span>{h.effectiveDifficulty.toFixed(3)}</span></div>
                          <div className="flex justify-between"><span>P / I</span><span>{h.predictedProbability.toFixed(3)} / {h.itemInformation.toFixed(3)}</span></div>
                          <div className="flex justify-between"><span>RT / expected</span><span>{Math.round(h.actualResponseTime / 1000)}s / {Math.round(h.expectedTime / 1000)}s</span></div>
                          <div className="flex justify-between"><span>difficulty</span><span>{h.difficultyChange}</span></div>
                          <div className="flex justify-between"><span>bloom transition</span><span>{h.bloomTransition}</span></div>
                          {h.selectionScore !== null && (
                            <div className="flex justify-between"><span>selection score</span><span>{Number(h.selectionScore).toFixed(3)}</span></div>
                          )}
                        </div>
                        <div className="space-y-2">
                          <p className="italic text-muted-foreground">
                            {h.adaptiveAction}
                          </p>
                          {h.candidates && h.candidates.length > 0 && (
                            <div>
                              <p className="font-semibold">
                                candidate ranking (top {h.candidates.length})
                              </p>
                              {h.candidates.map((c, ci) => (
                                <div
                                  key={c.questionId}
                                  className="flex justify-between"
                                >
                                  <span>
                                    {ci + 1}. {c.bloomLevel}
                                    {c.eligible ? "" : ` (${c.reason})`}
                                  </span>
                                  <span className="font-mono">
                                    U {c.utility.toFixed(3)} · P{" "}
                                    {c.probability.toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>
      </div>
    </main>
  );
}
