import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Flag,
  Loader2,
  MonitorPlay,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ViolationRow = {
  eventId: string;
  type: string;
  at: number;
  confidence: number;
  durationMs: number | null;
  reviewStatus: "active" | "dismissed";
  reviewReason: string | null;
  reviewedAt: number | null;
};

type StudentRow = {
  studentId: string;
  name: string;
  email: string | null;
  studentIdNumber: string | null;
  identityImageUrl: string | null;
  faceRegisteredAt: number | null;
  lastFaceCheckAt: number | null;
  lastFaceCheckStatus: "passed" | "failed" | null;
  submission: {
    id: string;
    status: "in_progress" | "submitted" | "graded";
    startedAt: number;
    timerStartedAt: number | null;
    submittedAt: number | null;
    currentQuestionIndex: number | null;
    violationCount: number;
    rawViolationCount: number;
    dismissedViolationCount: number;
    activeViolationCount: number;
    policyAction: string;
    riskScore: number;
    instructorFlags: Array<{
      id: string;
      note: string;
      at: number;
      instructorId: string;
      userId: string;
    }>;
  } | null;
  violations: ViolationRow[];
  feed: {
    frameDataUrl: string;
    cameraState: string;
    detectorMode: string;
    personCount: number;
    phoneCount: number;
    capturedAt: number;
  } | null;
};

type DashboardData = {
  assessment: {
    id: string;
    title: string;
    titleAr: string | null;
    classId: string;
    className: string;
    status: string;
    timeLimitMin: number;
  };
  students: StudentRow[];
  serverTime: number;
};

const ONLINE_WINDOW_MS = 8_000;

const VIOLATION_LABEL: Record<string, string> = {
  NO_PERSON: "Student left frame",
  MULTIPLE_PERSONS: "Multiple people",
  PHONE_DETECTED: "Phone detected",
  PHONE_IN_USE: "Phone in use",
  FACE_NOT_VISIBLE: "Face not visible",
  LOOKING_AWAY: "Looking away",
  TAB_SWITCH: "Tab switch",
  WINDOW_BLUR: "Window focus lost",
  BROWSER_MINIMIZED: "Browser minimized",
  CAMERA_DISABLED: "Camera disconnected",
  CAMERA_ERROR: "Camera error",
  IDENTITY_NOT_VERIFIED: "Identity not verified",
};

function timeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function FinalExamMonitor() {
  const { user, isLoading: authLoading } = useAuth();
  const { language, formatDate } = useI18n();
  const navigate = useNavigate();
  const { assessmentId } = useParams() as { assessmentId: string };
  const data = useQuery(
    api.finalMonitoring.getFinalExamLiveDashboard,
    assessmentId ? { assessmentId: assessmentId as Id<"instructorAssessments"> } : "skip",
  ) as DashboardData | undefined;

  const dismissViolation = useMutation(
    api.finalMonitoring.dismissAssessmentViolation,
  );
  const flagSuspicion = useMutation(api.finalMonitoring.flagAssessmentSuspicion);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [dismissTarget, setDismissTarget] = useState<{
    submissionId: string;
    eventId: string;
    type: string;
  } | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (data) setClockOffset(data.serverTime - Date.now());
  }, [data]);

  const serverNow = now + clockOffset;
  const selected = useMemo(
    () => data?.students.find((student) => student.studentId === selectedId) ?? null,
    [data, selectedId],
  );

  const stats = useMemo(() => {
    const rows = data?.students ?? [];
    const live = rows.filter(
      (row) =>
        row.submission?.status === "in_progress" &&
        row.feed &&
        serverNow - row.feed.capturedAt < ONLINE_WINDOW_MS,
    ).length;
    const activeAlerts = rows.reduce(
      (sum, row) => sum + (row.submission?.activeViolationCount ?? 0),
      0,
    );
    const dismissed = rows.reduce(
      (sum, row) => sum + (row.submission?.dismissedViolationCount ?? 0),
      0,
    );
    const submitted = rows.filter(
      (row) =>
        row.submission?.status === "submitted" ||
        row.submission?.status === "graded",
    ).length;
    return { live, activeAlerts, dismissed, submitted, total: rows.length };
  }, [data, serverNow]);

  const recentAlerts = useMemo(() => {
    return (data?.students ?? [])
      .flatMap((student) =>
        student.violations
          .filter((violation) => violation.reviewStatus === "active")
          .map((violation) => ({ student, violation })),
      )
      .sort((a, b) => b.violation.at - a.violation.at)
      .slice(0, 8);
  }, [data]);

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (user?.role !== "instructor") {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <ShieldAlert className="size-10 text-destructive" />
        <h1 className="text-2xl font-extrabold">Instructor access required</h1>
        <p className="text-sm text-muted-foreground">
          Live final-exam monitoring is restricted to the instructor who owns
          the final exam.
        </p>
        <Button className="rounded-full" onClick={() => navigate("/instructor")}>
          Back to instructor portal
        </Button>
      </main>
    );
  }

  if (data === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <ShieldAlert className="size-10 text-destructive" />
        <h1 className="text-2xl font-extrabold">Final exam not available</h1>
        <p className="text-sm text-muted-foreground">
          This live monitor only opens Fair Adaptive final exams you own.
        </p>
        <Button className="rounded-full" onClick={() => navigate("/instructor")}>
          Back to instructor portal
        </Button>
      </main>
    );
  }

  const title =
    language === "ar" ? data.assessment.titleAr?.trim() || data.assessment.title : data.assessment.title;

  const submitDismiss = async () => {
    if (!dismissTarget || dismissReason.trim().length < 5) return;
    setBusy(true);
    try {
      const result = await dismissViolation({
        submissionId: dismissTarget.submissionId as Id<"assessmentSubmissions">,
        eventId: dismissTarget.eventId,
        reason: dismissReason.trim(),
      });
      toast.success(
        `Violation dismissed. ${result.activeViolationCount} active violation(s) remain.`,
      );
      setDismissTarget(null);
      setDismissReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not dismiss violation");
    } finally {
      setBusy(false);
    }
  };

  const submitFlag = async () => {
    if (!selected?.submission || flagNote.trim().length < 3) return;
    setBusy(true);
    try {
      await flagSuspicion({
        submissionId: selected.submission.id as Id<"assessmentSubmissions">,
        note: flagNote.trim(),
      });
      toast.success("Suspicious behaviour flagged and written to the audit log.");
      setFlagOpen(false);
      setFlagNote("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not flag behaviour");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              onClick={() => navigate(`/instructor/assessments/${data.assessment.classId}`)}
              aria-label="Back to assessments"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-extrabold tracking-tight">{title}</h1>
                <Badge className="rounded-full bg-[oklch(0.72_0.14_145)]/15 text-[oklch(0.4_0.11_145)]">
                  Fair Adaptive final
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {data.assessment.className} · Live proctoring · {stats.total} students
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[oklch(0.72_0.14_145)]/15 px-3 py-1.5 font-bold text-[oklch(0.4_0.11_145)]">
              <span className="size-2 animate-pulse rounded-full bg-[oklch(0.55_0.14_145)]" />
              {stats.live} live
            </span>
            <span className="rounded-full bg-destructive/10 px-3 py-1.5 font-bold text-destructive">
              {stats.activeAlerts} active alerts
            </span>
            <span className="rounded-full bg-muted px-3 py-1.5 font-semibold text-muted-foreground">
              {stats.submitted} submitted
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-6 px-5 py-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {data.students.length === 0 && (
            <div className="clay col-span-full p-8 text-center text-sm text-muted-foreground">
              No students are enrolled in this class yet.
            </div>
          )}
          {data.students.map((student) => {
            const submission = student.submission;
            const feed = student.feed;
            const online =
              submission?.status === "in_progress" &&
              !!feed &&
              serverNow - feed.capturedAt < ONLINE_WINDOW_MS;
            const activeAlerts = student.violations.filter(
              (violation) => violation.reviewStatus === "active",
            );
            const elapsed =
              submission?.timerStartedAt ? serverNow - submission.timerStartedAt : 0;
            const remaining =
              data.assessment.timeLimitMin > 0
                ? data.assessment.timeLimitMin * 60_000 - elapsed
                : null;
            const identityOk =
              !!student.identityImageUrl &&
              student.faceRegisteredAt !== null &&
              student.lastFaceCheckStatus !== "failed";

            return (
              <article
                key={student.studentId}
                className="clay overflow-hidden p-0 transition-transform hover:-translate-y-0.5"
              >
                <button
                  type="button"
                  className="relative block aspect-[4/3] w-full overflow-hidden bg-[var(--input)] text-left"
                  onClick={() => setSelectedId(student.studentId)}
                >
                  {feed ? (
                    <img
                      src={feed.frameDataUrl}
                      alt={`${student.name} live camera`}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
                      <CameraOff className="size-7" />
                      <span className="text-xs">
                        {submission?.status === "in_progress"
                          ? "Waiting for camera…"
                          : "No live feed"}
                      </span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-8">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          online
                            ? "animate-pulse bg-[oklch(0.75_0.18_145)]"
                            : "bg-white/40",
                        )}
                      />
                      {online
                        ? "LIVE"
                        : submission?.status === "in_progress"
                          ? "RECONNECTING"
                          : submission
                            ? submission.status.toUpperCase()
                            : "NOT STARTED"}
                    </span>
                    {feed && (
                      <span className="text-[10px] font-semibold text-white/80">
                        {feed.detectorMode === "yolo26n" ? "YOLO26n" : feed.detectorMode}
                      </span>
                    )}
                  </div>
                  {activeAlerts.length > 0 && (
                    <span className="absolute end-2 top-2 inline-flex items-center gap-1 rounded-full bg-destructive px-2 py-1 text-[10px] font-extrabold text-white">
                      <AlertTriangle className="size-3" />
                      {activeAlerts.length}
                    </span>
                  )}
                </button>

                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{student.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {student.studentIdNumber ?? student.email ?? "No student ID"}
                      </p>
                    </div>
                    {student.identityImageUrl ? (
                      <img
                        src={student.identityImageUrl}
                        alt={`${student.name} identity`}
                        className="size-10 shrink-0 rounded-lg border object-cover"
                      />
                    ) : (
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <UserRound className="size-4 text-muted-foreground" />
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5",
                        identityOk
                          ? "bg-[oklch(0.72_0.14_145)]/15 text-[oklch(0.4_0.11_145)]"
                          : "bg-amber-500/10 text-amber-700",
                      )}
                    >
                      {identityOk ? "Identity verified" : "Identity needs review"}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5",
                        (feed?.personCount ?? 0) === 1
                          ? "bg-[oklch(0.72_0.14_145)]/15 text-[oklch(0.4_0.11_145)]"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {feed?.personCount ?? 0} person(s)
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5",
                        (feed?.phoneCount ?? 0) === 0
                          ? "bg-muted text-muted-foreground"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {feed?.phoneCount ?? 0} phone(s)
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {submission?.status === "in_progress"
                        ? remaining === null
                          ? `Elapsed ${clock(elapsed)}`
                          : `Remaining ${clock(remaining)}`
                        : submission
                          ? `Submitted ${feed ? timeAgo(feed.capturedAt, serverNow) : ""}`
                          : "Not started"}
                    </span>
                    <span>
                      {feed ? `Frame ${timeAgo(feed.capturedAt, serverNow)}` : "No frame"}
                    </span>
                  </div>

                  {student.violations.length > 0 && (
                    <div className="flex items-center justify-between rounded-xl bg-[var(--accent)]/40 px-2.5 py-2 text-[11px]">
                      <span className="font-semibold">
                        {activeAlerts.length} active ·{" "}
                        {student.violations.length - activeAlerts.length} dismissed
                      </span>
                      <span className="text-muted-foreground">
                        risk {Math.round((submission?.riskScore ?? 0) * 100)}%
                      </span>
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full rounded-full"
                    onClick={() => setSelectedId(student.studentId)}
                    disabled={!submission}
                  >
                    <MonitorPlay className="mr-1.5 size-3.5" />
                    Inspect feed & violations
                  </Button>
                </div>
              </article>
            );
          })}
        </section>

        <aside className="space-y-4">
          <div className="clay p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold">Live alerts</h2>
              <Badge variant="outline" className="rounded-full text-[10px]">
                newest first
              </Badge>
            </div>
            <div className="mt-3 space-y-2">
              {recentAlerts.length === 0 && (
                <p className="rounded-xl bg-[var(--accent)]/40 p-3 text-xs text-muted-foreground">
                  No active YOLO alerts. Detections appear here after their grace
                  period is confirmed.
                </p>
              )}
              {recentAlerts.map(({ student, violation }) => (
                <button
                  key={`${student.studentId}-${violation.eventId}`}
                  type="button"
                  onClick={() => setSelectedId(student.studentId)}
                  className="flex w-full items-start gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--accent)]/40"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold">
                      {VIOLATION_LABEL[violation.type] ?? violation.type}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {student.name} · {timeAgo(violation.at, serverNow)} ·{" "}
                      {Math.round(violation.confidence * 100)}%
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="clay p-5 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 font-bold text-foreground">
              <ShieldCheck className="size-4 text-primary" />
              Secure review workspace
            </div>
            <p className="mt-2 leading-relaxed">
              Feeds, identity images, and dismissal controls are visible only to
              the instructor who owns this final exam. Dismissing a detection
              keeps the original YOLO evidence while updating the active
              violation count. Every decision is written to the audit log with
              its reason and timestamp.
            </p>
          </div>
        </aside>
      </div>

      {/* Individual student inspection */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="clay max-h-[92vh] overflow-y-auto border-0 sm:max-w-5xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {selected.name}
                  {selected.submission?.status === "in_progress" ? (
                    <Badge className="rounded-full bg-[oklch(0.72_0.14_145)]/15 text-[oklch(0.4_0.11_145)]">
                      In progress
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="rounded-full">
                      {selected.submission?.status ?? "Not started"}
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {selected.studentIdNumber ?? selected.email ?? "Student"} ·{" "}
                  {data.assessment.className}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <div className="space-y-3">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--input)]">
                    {selected.feed ? (
                      <img
                        src={selected.feed.frameDataUrl}
                        alt={`${selected.name} live feed`}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Camera className="size-8" />
                        <p className="text-xs">No camera snapshot has arrived yet.</p>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-8 text-[11px] font-bold text-white">
                      <span>
                        {selected.feed
                          ? `Captured ${timeAgo(selected.feed.capturedAt, serverNow)}`
                          : "Offline"}
                      </span>
                      <span>
                        {selected.feed
                          ? `${selected.feed.personCount} person(s) · ${selected.feed.phoneCount} phone(s)`
                          : ""}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div className="rounded-xl bg-[var(--accent)]/40 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Camera
                      </p>
                      <p className="mt-1 font-bold">
                        {selected.feed?.cameraState ?? "No feed"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--accent)]/40 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Detector
                      </p>
                      <p className="mt-1 font-bold">
                        {selected.feed?.detectorMode ?? "—"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--accent)]/40 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Risk
                      </p>
                      <p className="mt-1 font-bold">
                        {Math.round((selected.submission?.riskScore ?? 0) * 100)}%
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--accent)]/40 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Policy
                      </p>
                      <p className="mt-1 font-bold">
                        {selected.submission?.policyAction ?? "NONE"}
                      </p>
                    </div>
                  </div>

                  <div className="clay-inset flex items-center gap-3 p-3">
                    {selected.identityImageUrl ? (
                      <img
                        src={selected.identityImageUrl}
                        alt={`${selected.name} registered identity`}
                        className="h-20 w-16 rounded-lg border object-cover"
                      />
                    ) : (
                      <div className="flex h-20 w-16 items-center justify-center rounded-lg bg-muted">
                        <UserRound className="size-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 text-xs">
                      <p className="font-bold">Registered identity</p>
                      <p className="mt-1 text-muted-foreground">
                        Face registration:{" "}
                        {selected.faceRegisteredAt
                          ? formatDate(selected.faceRegisteredAt)
                          : "Not registered"}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        Last check:{" "}
                        {selected.lastFaceCheckAt
                          ? `${formatDate(selected.lastFaceCheckAt)} (${selected.lastFaceCheckStatus ?? "unknown"})`
                          : "No verification check yet"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-extrabold">
                        YOLO violations ({selected.violations.length})
                      </h3>
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        {selected.submission?.activeViolationCount ?? 0} active
                      </Badge>
                    </div>
                    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
                      {selected.violations.length === 0 && (
                        <p className="rounded-xl bg-[var(--accent)]/40 p-3 text-xs text-muted-foreground">
                          No YOLO-detected violations for this student.
                        </p>
                      )}
                      {selected.violations
                        .slice()
                        .sort((a, b) => b.at - a.at)
                        .map((violation) => (
                          <div
                            key={violation.eventId}
                            className={cn(
                              "rounded-xl border p-3 text-xs",
                              violation.reviewStatus === "dismissed"
                                ? "border-[var(--border)] bg-muted/30 opacity-75"
                                : "border-destructive/30 bg-destructive/5",
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-bold">
                                  {VIOLATION_LABEL[violation.type] ?? violation.type}
                                </p>
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  {formatDate(violation.at)} ·{" "}
                                  {Math.round(violation.confidence * 100)}% confidence
                                  {violation.durationMs
                                    ? ` · ${Math.round(violation.durationMs / 1000)}s`
                                    : ""}
                                </p>
                              </div>
                              {violation.reviewStatus === "dismissed" ? (
                                <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 shrink-0 rounded-full px-2.5 text-[10px]"
                                  onClick={() => {
                                    if (!selected.submission) return;
                                    setDismissTarget({
                                      submissionId: selected.submission.id,
                                      eventId: violation.eventId,
                                      type: violation.type,
                                    });
                                    setDismissReason("");
                                  }}
                                >
                                  Dismiss
                                </Button>
                              )}
                            </div>
                            {violation.reviewStatus === "dismissed" && (
                              <div className="mt-2 rounded-lg bg-background/70 p-2 text-[10px]">
                                <p className="font-semibold">Dismissed by instructor</p>
                                <p className="mt-0.5 text-muted-foreground">
                                  {violation.reviewedAt
                                    ? formatDate(violation.reviewedAt)
                                    : ""}{" "}
                                  · {violation.reviewReason}
                                </p>
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] p-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-extrabold">Instructor flags</h3>
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        {selected.submission?.instructorFlags.length ?? 0}
                      </Badge>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {(selected.submission?.instructorFlags ?? [])
                        .slice()
                        .sort((a, b) => b.at - a.at)
                        .map((flag) => (
                          <div
                            key={flag.id}
                            className="rounded-lg bg-amber-500/10 p-2 text-[11px]"
                          >
                            <p className="font-semibold">{flag.note}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {formatDate(flag.at)}
                            </p>
                          </div>
                        ))}
                      {!selected.submission?.instructorFlags.length && (
                        <p className="text-[11px] text-muted-foreground">
                          No manual suspicion flags.
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full rounded-full"
                      disabled={!selected.submission}
                      onClick={() => {
                        setFlagNote("");
                        setFlagOpen(true);
                      }}
                    >
                      <Flag className="mr-1.5 size-3.5" /> Flag suspicious behaviour
                    </Button>
                  </div>

                  <div className="rounded-xl bg-[var(--accent)]/40 p-3 text-[10px] text-muted-foreground">
                    {selected.submission
                      ? `Submitted ${selected.submission.submittedAt ? formatDate(selected.submission.submittedAt) : "not yet"} · ${selected.submission.rawViolationCount} original detections · ${selected.submission.dismissedViolationCount} dismissed`
                      : "This student has not started the final exam."}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dismiss reason */}
      <Dialog
        open={!!dismissTarget}
        onOpenChange={(open) => !open && setDismissTarget(null)}
      >
        <DialogContent className="clay border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dismiss this violation?</DialogTitle>
            <DialogDescription>
              The original YOLO detection remains in the record. Enter a reason;
              your identity, decision, and timestamp are written to the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">
              Violation
            </Label>
            <p className="rounded-xl bg-[var(--accent)]/40 px-3 py-2 text-xs font-semibold">
              {dismissTarget
                ? VIOLATION_LABEL[dismissTarget.type] ?? dismissTarget.type
                : ""}
            </p>
            <Label className="mt-2 text-xs font-semibold">Reason (required)</Label>
            <Textarea
              value={dismissReason}
              onChange={(event) => setDismissReason(event.target.value)}
              placeholder="Explain why this detection was not misconduct…"
              className="clay-inset min-h-24 rounded-2xl px-4 py-3"
            />
            <p className="text-[10px] text-muted-foreground">
              Minimum 5 characters. This cannot delete the detector evidence.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setDismissTarget(null)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={busy || dismissReason.trim().length < 5}
              onClick={() => void submitDismiss()}
            >
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Dismiss violation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual flag reason */}
      <Dialog open={flagOpen} onOpenChange={setFlagOpen}>
        <DialogContent className="clay border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Flag suspicious behaviour</DialogTitle>
            <DialogDescription>
              Add a manual note for this student. The note and audit trail are
              visible to you; detector evidence is unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">Observation</Label>
            <Textarea
              value={flagNote}
              onChange={(event) => setFlagNote(event.target.value)}
              placeholder="Describe what you observed…"
              className="clay-inset min-h-24 rounded-2xl px-4 py-3"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setFlagOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={busy || flagNote.trim().length < 3}
              onClick={() => void submitFlag()}
            >
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Flag and log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
