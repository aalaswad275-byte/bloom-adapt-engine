/**
 * Last-resort in-browser object detector. The primary detector is YOLO26n in
 * the Python service; this exists so an exam keeps person/phone monitoring if
 * that service is temporarily unreachable.
 */

export type BrowserObjectDetector = {
  detect: (input: HTMLVideoElement) => Promise<
    Array<{
      class: string;
      score: number;
      bbox: [number, number, number, number];
    }>
  >;
};

let modelPromise: Promise<BrowserObjectDetector> | null = null;

export function loadBrowserObjectDetector(): Promise<BrowserObjectDetector> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import("@tensorflow/tfjs");
      await tf.ready();
      const cocoSsd = await import("@tensorflow-models/coco-ssd");
      return cocoSsd.load({ base: "lite_mobilenet_v2" });
    })().catch((error) => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}
