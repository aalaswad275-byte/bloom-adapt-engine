import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { CalendarClock, Loader2, Pencil } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  epochToZonedInput,
  formatDuration,
  formatSchedule,
  localTimeZone,
  schedulePhase,
  zonedInputToEpoch,
} from "@/lib/finalSchedule";
import { cn } from "@/lib/utils";

const COMMON_ZONES = [
  "UTC",
  "Asia/Baghdad",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Amman",
  "Asia/Beirut",
  "Asia/Cairo",
  "Asia/Kuwait",
  "Asia/Qatar",
  "Africa/Tripoli",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
];

export function FinalScheduleCard({
  assessmentId,
  startAt,
  endAt,
  timeZone,
  compact = false,
}: {
  assessmentId: string;
  startAt: number | null;
  endAt: number | null;
  timeZone: string | null;
  compact?: boolean;
}) {
  const save = useMutation(api.finalSchedule.scheduleFinalExam);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zone, setZone] = useState(timeZone || localTimeZone());
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const phase = schedulePhase(startAt, endAt, now);
  const effectiveZone = timeZone || localTimeZone();

  const openEditor = () => {
    const nextZone = timeZone || localTimeZone();
    setZone(nextZone);
    setStart(epochToZonedInput(startAt, nextZone));
    setEnd(epochToZonedInput(endAt, nextZone));
    setOpen(true);
  };

  const changeZone = (nextZone: string) => {
    setZone(nextZone);
    // Preserve the same instants while showing them in the new timezone;
    // skip the conversion while the user is still typing an invalid zone.
    try {
      setStart(epochToZonedInput(startAt, nextZone));
      setEnd(epochToZonedInput(endAt, nextZone));
    } catch {
      // Leave the current input values until the timezone is valid.
    }
  };

  const submit = async () => {
    let startMs = NaN;
    let endMs = NaN;
    try {
      startMs = zonedInputToEpoch(start, zone);
      endMs = zonedInputToEpoch(end, zone);
    } catch {
      toast.error("Choose a valid timezone and date/time.");
      return;
    }
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      toast.error("Choose a valid start and end date/time.");
      return;
    }
    if (endMs <= startMs) {
      toast.error("The exam end must be after its start.");
      return;
    }
    setBusy(true);
    try {
      await save({
        assessmentId: assessmentId as Id<"instructorAssessments">,
        startAt: startMs,
        endAt: endMs,
        timeZone: zone,
      });
      toast.success("Final exam schedule saved.");
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the schedule",
      );
    } finally {
      setBusy(false);
    }
  };

  const status =
    phase === "upcoming"
      ? `Starts in ${formatDuration((startAt ?? now) - now)}`
      : phase === "open"
        ? `Ends in ${formatDuration((endAt ?? now) - now)}`
        : phase === "ended"
          ? "Window closed"
          : "Not scheduled";

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-2xl",
          compact
            ? "bg-[var(--accent)]/40 px-3 py-1.5 text-[10px]"
            : "clay-inset p-3 text-xs",
        )}
      >
        <CalendarClock
          className={cn("shrink-0 text-primary", compact ? "size-3" : "size-4")}
        />
        <div className="min-w-0 flex-1">
          {startAt && endAt ? (
            <>
              <p className={cn("font-bold", compact && "text-[10px]")}>
                {formatSchedule(startAt, effectiveZone)} →{" "}
                {formatSchedule(endAt, effectiveZone)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {effectiveZone} · {status}
              </p>
            </>
          ) : (
            <>
              <p className={cn("font-bold", compact && "text-[10px]")}>
                No exam window set
              </p>
              <p className="text-[10px] text-muted-foreground">
                Set a start and end to enforce access.
              </p>
            </>
          )}
        </div>
        <Badge
          variant="outline"
          className={cn(
            "rounded-full",
            phase === "open" && "border-emerald-600/30 text-emerald-700",
            phase === "upcoming" && "border-amber-600/30 text-amber-700",
            phase === "ended" && "border-destructive/30 text-destructive",
          )}
        >
          {phase === "open"
            ? "Open"
            : phase === "upcoming"
              ? "Scheduled"
              : phase === "ended"
                ? "Closed"
                : "Unscheduled"}
        </Badge>
        <Button
          size="sm"
          variant="outline"
          className={cn("rounded-full", compact ? "h-6 px-2 text-[10px]" : "h-7")}
          onClick={openEditor}
        >
          <Pencil className="mr-1 size-3" />
          {startAt ? "Edit schedule" : "Schedule exam"}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="clay border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Final exam window</DialogTitle>
            <DialogDescription>
              Students can only open and submit the final between these times.
              In-progress attempts are automatically graded and closed at the
              end. All times use one timezone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="final-timezone" className="text-xs font-semibold">
                Timezone
              </Label>
              <Input
                id="final-timezone"
                list="final-timezone-options"
                value={zone}
                onChange={(event) => changeZone(event.target.value)}
                className="rounded-full"
              />
              <datalist id="final-timezone-options">
                {COMMON_ZONES.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
              <p className="text-[10px] text-muted-foreground">
                Browser timezone: {localTimeZone()}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="final-start" className="text-xs font-semibold">
                  Start date &amp; time
                </Label>
                <Input
                  id="final-start"
                  type="datetime-local"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  className="rounded-full"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="final-end" className="text-xs font-semibold">
                  End date &amp; time
                </Label>
                <Input
                  id="final-end"
                  type="datetime-local"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  className="rounded-full"
                />
              </div>
            </div>
            <p className="rounded-xl bg-[var(--accent)]/50 p-2 text-[10px] text-muted-foreground">
              Overlapping final windows for your other classes are rejected.
              The timezone is stored with the exam and shown consistently to
              students and instructors.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={busy || !start || !end || !zone}
              onClick={() => void submit()}
            >
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save window
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
