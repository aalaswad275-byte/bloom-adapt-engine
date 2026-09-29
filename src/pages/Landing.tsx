import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Camera,
  FlaskConical,
  Gauge,
  Layers,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { Link } from "react-router";

const FEATURES = [
  {
    icon: BrainCircuit,
    title: "Bloom-Integrated 2PL IRT",
    body: "One ability per Bloom level, estimated by MAP under the extended model — never a single global theta.",
    tint: "bg-[oklch(0.93_0.05_320)]",
  },
  {
    icon: Timer,
    title: "Signed Time Strain",
    body: "(RT − E)/(E + ε) feeds the item difficulty. Fast correct answers raise P; strain lowers it. Sign is never discarded.",
    tint: "bg-[oklch(0.93_0.05_260)]",
  },
  {
    icon: Camera,
    title: "Visual Mismatch V",
    body: "Gaze and attention signals become an assessment variable via −δ·V — separate from integrity monitoring.",
    tint: "bg-[oklch(0.92_0.06_150)]",
  },
  {
    icon: Layers,
    title: "Information-Based Selection",
    body: "Every next item maximizes a weighted utility: IRT information, target probability, Bloom quotas, diagnostics.",
    tint: "bg-[oklch(0.94_0.05_85)]",
  },
  {
    icon: ShieldCheck,
    title: "Independent Integrity Engine",
    body: "Aggregated evidence — never a single detection — produces warnings, violations, and the 3-strike rule.",
    tint: "bg-[oklch(0.92_0.06_25)]",
  },
  {
    icon: FlaskConical,
    title: "Reproducible Research Log",
    body: "Theta before/after, a, b, T, V, P, information, candidates and scores — every decision reconstructable.",
    tint: "bg-[oklch(0.93_0.05_200)]",
  },
];

const PIPELINE = [
  "Answer",
  "Time strain T",
  "Visual mismatch V",
  "P(θ, a, b, γT, δV)",
  "MAP θ update",
  "Behavior case",
  "Utility ranking",
  "Next item",
];

export default function Landing() {
  const { isAuthenticated } = useAuth();

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* pastel clay blobs */}
      <div className="clay-blob left-[-10%] top-[-10%] size-[420px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] top-[20%] size-[380px] bg-[oklch(0.86_0.08_200)]" />
      <div className="clay-blob bottom-[-12%] left-[30%] size-[440px] bg-[oklch(0.88_0.08_150)]" />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-8">
        <div className="flex items-center gap-3">
          <div className="clay-sm flex size-11 items-center justify-center">
            <BrainCircuit className="size-6 text-primary" />
          </div>
          <span className="text-lg font-bold tracking-tight">
            AdaptiveMind
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Link to="/dashboard">
              <Button className="clay-press rounded-full">Dashboard</Button>
            </Link>
          ) : (
            <Link to="/auth?returnTo=%2Fdashboard">
              <Button className="clay-press rounded-full">Sign in</Button>
            </Link>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto mt-16 w-full max-w-6xl px-6 text-center">
        <Badge className="clay-sm mb-6 rounded-full px-4 py-1.5 text-xs font-semibold text-primary">
          Master's research · Bloom's Taxonomy-Integrated Adaptive IRT
        </Badge>
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl md:text-6xl">
          Assessment that{" "}
          <span className="text-primary">adapts to how you think</span>, not
          just what you answer.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
          A research-grade adaptive testing engine fusing 2-parameter IRT,
          six-dimensional Bloom ability profiles, signed time strain, and
          visual-mismatch modeling — with academic-integrity monitoring kept
          rigorously separate.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link to={isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard"}>
            <Button size="lg" className="clay-press rounded-full px-8 text-base">
              Start an adaptive exam
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </Link>
          <Link to="/auth?returnTo=%2Fdashboard">
            <Button
              size="lg"
              variant="outline"
              className="clay-press rounded-full px-8 text-base"
            >
              Sign in to your profile
            </Button>
          </Link>
        </div>

        {/* Model equation card */}
        <div className="clay mx-auto mt-14 max-w-2xl p-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            The proposed model
          </p>
          <p className="mt-4 font-mono text-sm leading-relaxed sm:text-base">
            P<sub>i,t,c</sub> = 1 / (1 + exp(−a·(θ
            <sub>t,c</sub> − b<sub>i,t,c</sub> − γ·T<sub>t</sub> − δ·V
            <sub>i,t</sub>)))
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3 text-left text-xs text-muted-foreground">
            <div className="clay-inset p-3">
              <span className="font-semibold text-foreground">γ·T — time strain</span>
              <p>fast answers ↑ P · slow ↓ P</p>
            </div>
            <div className="clay-inset p-3">
              <span className="font-semibold text-foreground">δ·V — visual mismatch</span>
              <p>attention drift inflates difficulty</p>
            </div>
            <div className="clay-inset p-3">
              <span className="font-semibold text-foreground">θ per Bloom level</span>
              <p>six abilities, updated independently</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 mx-auto mt-24 w-full max-w-6xl px-6">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
          One engine, seven research subsystems
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card
              key={f.title}
              className="clay clay-press border-0 bg-transparent p-0 shadow-none transition-transform"
            >
              <CardContent className="p-6">
                <div
                  className={`clay-sm mb-4 flex size-12 items-center justify-center ${f.tint}`}
                >
                  <f.icon className="size-6 text-foreground" />
                </div>
                <h3 className="text-base font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Pipeline */}
      <section className="relative z-10 mx-auto mt-24 w-full max-w-5xl px-6">
        <div className="clay p-8 sm:p-10">
          <div className="flex items-center gap-3">
            <Activity className="size-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
              The adaptive response pipeline
            </h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Every answer flows through the full mathematical workflow — nothing
            is reduced to "correct → harder".
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            {PIPELINE.map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <span className="clay-inset rounded-full px-4 py-2 text-xs font-semibold">
                  {step}
                </span>
                {i < PIPELINE.length - 1 && (
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Research strip */}
      <section className="relative z-10 mx-auto mt-24 w-full max-w-6xl px-6">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              icon: BarChart3,
              title: "For the researcher",
              body: "Full adaptive history: candidate items, utilities, selection scores, Bloom transitions, and effective difficulty per step.",
            },
            {
              icon: Gauge,
              title: "For the student",
              body: "A fairer exam: items match your ability, your pace is part of the model, and your Bloom profile drives recommendations.",
            },
            {
              icon: ShieldCheck,
              title: "For the proctor",
              body: "Evidence-aggregated integrity monitoring with configurable thresholds — independent from all ability estimation.",
            },
          ].map((c) => (
            <div key={c.title} className="clay clay-press p-6">
              <c.icon className="size-6 text-primary" />
              <h3 className="mt-4 text-base font-bold">{c.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 mx-auto my-24 w-full max-w-3xl px-6 text-center">
        <div className="clay p-10">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Run your first adaptive session
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Sign in, start the seeded diagnostic exam, and watch the six-level
            Bloom profile, time-strain mechanics, and integrity engine work
            together in real time.
          </p>
          <Link to={isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard"}>
            <Button size="lg" className="clay-press mt-7 rounded-full px-8">
              {isAuthenticated ? "Go to dashboard" : "Sign in to begin"}
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="relative z-10 pb-10 text-center text-xs text-muted-foreground">
        AdaptiveMind · Bloom's Taxonomy-Integrated Adaptive IRT · research
        prototype v1
      </footer>
    </main>
  );
}
