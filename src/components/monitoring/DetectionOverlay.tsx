import type { MonitorDetectionBox } from "@/lib/monitoring";

/**
 * Draws YOLO bounding boxes over the (mirrored) webcam preview. Coordinates
 * arrive normalized to the unmirrored camera frame, so the horizontal position
 * is flipped here to line up with the CSS-mirrored video.
 */
export function DetectionOverlay({
  boxes,
}: {
  boxes: MonitorDetectionBox[];
}) {
  if (boxes.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {boxes.map((box, index) => {
        const isPhone = box.className === "cell phone";
        return (
          <div
            key={`${box.className}-${index}`}
            className="absolute rounded-md border-2"
            style={{
              left: `${(1 - box.x - box.width) * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
              borderColor: isPhone
                ? "oklch(0.62 0.2 25)"
                : "oklch(0.68 0.15 145)",
              boxShadow: "0 0 0 1px oklch(0 0 0 / 0.25)",
            }}
          >
            <span
              className="absolute -top-5 start-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
              style={{
                backgroundColor: isPhone
                  ? "oklch(0.62 0.2 25)"
                  : "oklch(0.48 0.13 145)",
              }}
            >
              {isPhone ? "Phone" : "Person"}{" "}
              {Math.round(box.confidence * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
