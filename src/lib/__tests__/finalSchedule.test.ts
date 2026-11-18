import { describe, expect, test } from "bun:test";
import {
  epochToZonedInput,
  schedulePhase,
  zonedInputToEpoch,
} from "../finalSchedule";

describe("final schedule windows", () => {
  test("phase transitions from upcoming to open to ended", () => {
    const start = Date.UTC(2026, 10, 18, 9, 0);
    const end = Date.UTC(2026, 10, 18, 11, 0);
    expect(schedulePhase(start, end, start - 1)).toBe("upcoming");
    expect(schedulePhase(start, end, start)).toBe("open");
    expect(schedulePhase(start, end, end - 1)).toBe("open");
    expect(schedulePhase(start, end, end)).toBe("ended");
    expect(schedulePhase(null, end, start)).toBe("unscheduled");
  });

  test("converts a wall-clock time in a non-local timezone to epoch", () => {
    const epoch = zonedInputToEpoch("2026-11-18T09:30", "Asia/Baghdad");
    expect(epoch).toBe(Date.UTC(2026, 10, 18, 6, 30));
  });

  test("round-trips an epoch through a timezone input value", () => {
    const epoch = Date.UTC(2026, 10, 18, 6, 30);
    expect(epochToZonedInput(epoch, "Asia/Baghdad")).toBe(
      "2026-11-18T09:30",
    );
  });

  test("handles daylight-saving offsets rather than a fixed offset", () => {
    const winter = zonedInputToEpoch("2026-01-15T12:00", "America/New_York");
    const summer = zonedInputToEpoch("2026-07-15T12:00", "America/New_York");
    expect(winter).toBe(Date.UTC(2026, 0, 15, 17, 0));
    expect(summer).toBe(Date.UTC(2026, 6, 15, 16, 0));
  });
});
