import { useMutation, useQuery } from "convex/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import { BLOOM_LABEL, BLOOM_LEVELS, type BloomLevel } from "@/lib/irt";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Loader2,
  Play,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

type DashboardData = {
  exams: Array<{
    _id: string;
    title: string;
    description: string | null;
    totalQuestions: number;
    bloomDistribution: Record<BloomLevel, number>;
    gamma: number;
    delta: number;
    violationThreshold: number;
  }>;
  sessions: Array<{
    sessionId: string;
    examTitle: string;
    status: string;
    terminationReason: string | null;
    startedAt: number;
    completedAt: number | null;
    answered: number;
    total: number;
    correct: number;
    riskScore: number;
    confirmedViolations: number;
    thetaProfile: Record<BloomLevel, number>;
  }>;
  latestProfile: Record<BloomLevel, number> | null;
};

function ProfileRadar({
  profile,
}: {
  profile: Record<BloomLevel, number> | null;
}) {
  if (!profile) {
    return (
      <div className="clay-inset flex h-60 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Complete an exam to grow your six-dimensional Bloom profile.
      </div>
    );
  }
  const data = BLOOM_LEVELS.map((l) => ({
    level: BLOOM_LABEL[l],
    theta: Number(profile[l].toFixed(2)),
  }));
  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
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
  );
}

function StatusPill({ s }: { s: DashboardData["sessions"][number] }) {
  if (s.status === "active")
    return (
      <Badge className="rounded-full bg-[oklch(0.9_0.06_85)] text-[oklch(0.35_0.08_85)]">
        in progress
      </Badge>
    );
  if (s.status === "terminated")
    return (
      <Badge className="rounded-full bg-destructive text-white">
        terminated
      </Badge>
    );
  return (
    <Badge className="rounded-full bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]">
      completed
    </Badge>
  );
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const data = useQuery(api.adaptive.getDashboard) as DashboardData | undefined;
  const seed = useMutation(api.exams.seedDatabase);
  const seedStarted = useRef(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  // First visit: seed the demo exam + question bank automatically.
  useEffect(() => {
    if (data === undefined || data.exams.length > 0) return;
    if (seedStarted.current) return;
    seedStarted.current = true;
    seed().catch((err: unknown) =>
      setSeedError(err instanceof Error ? err.message : "Seeding failed"),
    );
  }, [data, seed]);

  if (data === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-8%] top-[-8%] size-[360px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-6%] top-[35%] size-[320px] bg-[oklch(0.86_0.08_200)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-8">
        <Link to="/" className="flex items-center gap-3">
          <div className="clay-sm flex size-10 items-center justify-center">
            <BrainCircuit className="size-5 text-primary" />
          </div>
          <span className="font-bold tracking-tight">AdaptiveMind</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:block">
            {user?.email ?? "Guest researcher"}
          </span>
          <Button
            variant="outline"
            className="clay-press rounded-full"
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </header>

      <section className="relative z-10 mx-auto mt-10 w-full max-w-6xl px-6">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          Your assessment workspace
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Start the adaptive diagnostic, review your Bloom ability profile, and
          inspect past adaptive sessions.
        </p>
      </section>

      {seedError && (
        <div className="relative z-10 mx-auto mt-4 w-full max-w-6xl px-6">
          <div className="clay-inset flex items-center gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="size-4" /> {seedError}
          </div>
        </div>
      )}

      <div className="relative z-10 mx-auto mt-8 grid w-full max-w-6xl gap-6 px-6 lg:grid-cols-3">
        {/* Exams */}
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-lg font-bold">Available exams</h2>
          {data.exams.length === 0 && (
            <div className="clay p-6 text-sm text-muted-foreground">
              Preparing the question bank…
            </div>
          )}
          {data.exams.map((exam) => (
            <div key={exam._id} className="clay clay-press p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-xl">
                  <h3 className="text-base font-bold">{exam.title}</h3>
                  {exam.description && (
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {exam.description}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className="clay-inset rounded-full text-xs text-foreground">
                      {exam.totalQuestions} adaptive items
                    </Badge>
                    <Badge className="clay-inset rounded-full text-xs text-foreground">
                      γ {exam.gamma} · δ {exam.delta}
                    </Badge>
                    <Badge className="clay-inset rounded-full text-xs text-foreground">
                      {exam.violationThreshold}-violation rule
                    </Badge>
                  </div>
                  <div className="mt-4 space-y-2">
                    {BLOOM_LEVELS.map((l) => (
                      <div key={l} className="flex items-center gap-3">
                        <span className="w-24 text-xs font-medium text-muted-foreground">
                          {BLOOM_LABEL[l]}
                        </span>
                        <Progress value={exam.bloomDistribution[l] * 100} className="h-2" />
                        <span className="w-10 text-right text-xs text-muted-foreground">
                          {pct(exam.bloomDistribution[l])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <Button
                  className="clay-press rounded-full"
                  onClick={() => navigate(`/exam/${exam._id}`)}
                >
                  <Play className="mr-1.5 size-4" /> Start exam
                </Button>
              </div>
            </div>
          ))}

          {/* Sessions */}
          <h2 className="pt-4 text-lg font-bold">Your sessions</h2>
          {data.sessions.length === 0 && (
            <div className="clay p-6 text-sm text-muted-foreground">
              No sessions yet — start the diagnostic above.
            </div>
          )}
          {data.sessions.map((s) => (
            <Link key={s.sessionId} to={`/results/${s.sessionId}`} className="block">
              <div className="clay clay-press p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{s.examTitle}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.answered}/{s.total} items · {s.correct} correct ·{" "}
                      {s.completedAt
                        ? new Date(s.completedAt).toLocaleString()
                        : "in progress"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.confirmedViolations > 0 && (
                      <Badge className="rounded-full bg-destructive text-white">
                        <ShieldCheck className="mr-1 size-3" />
                        {s.confirmedViolations} violation
                        {s.confirmedViolations > 1 ? "s" : ""}
                      </Badge>
                    )}
                    <StatusPill s={s} />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Profile column */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold">Bloom ability profile</h2>
          <div className="clay p-5">
            <ProfileRadar profile={data.latestProfile} />
            {(() => {
              const profile = data.latestProfile;
              if (!profile) return null;
              return (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {BLOOM_LEVELS.map((l) => (
                    <div key={l} className="clay-inset px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {BLOOM_LABEL[l]}
                      </p>
                      <p className="text-sm font-bold">θ {profile[l].toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          <div className="clay p-5 text-xs leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">How to read θ</p>
            <p className="mt-1">
              Each Bloom level has an independent ability estimate on the IRT
              logit scale (higher = stronger). Update only the level you
              answered; speed and visual attention shift item difficulty
              through γ·T and δ·V.
            </p>
          </div>
        </div>
      </div>

      <footer className="relative z-10 py-10 text-center text-xs text-muted-foreground">
        AdaptiveMind · research prototype v1
      </footer>
    </main>
  );
}
