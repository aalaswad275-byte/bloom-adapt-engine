/** Shared schedule math for Fair Adaptive final exam windows. */

export type SchedulePhase = "unscheduled" | "upcoming" | "open" | "ended";

export function schedulePhase(
  startAt: number | null | undefined,
  endAt: number | null | undefined,
  now = Date.now(),
): SchedulePhase {
  if (!startAt || !endAt) return "unscheduled";
  if (now < startAt) return "upcoming";
  if (now >= endAt) return "ended";
  return "open";
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatSchedule(
  timestamp: number | null | undefined,
  timeZone?: string | null,
): string {
  if (!timestamp) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function zonedParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Convert a datetime-local value interpreted in `timeZone` to epoch ms. */
export function zonedInputToEpoch(value: string, timeZone: string): number {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return NaN;
  const [, y, mo, d, h, mi, s] = match;
  const wallClock = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  );
  let guess = wallClock;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(guess, timeZone);
    const represented = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    guess += wallClock - represented;
  }
  return guess;
}

/** datetime-local input value for an epoch, rendered in `timeZone`. */
export function epochToZonedInput(
  timestamp: number | null | undefined,
  timeZone: string,
): string {
  if (!timestamp) return "";
  const p = zonedParts(timestamp, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(
    p.minute,
  )}`;
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
