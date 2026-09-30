import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Camera,
  GraduationCap,
  IdCard,
  Loader2,
  RefreshCcw,
  Upload,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

type Viewer = {
  role: string | null;
  claimed: boolean;
  student: { hasIdentityImage: boolean } | null;
} | null;

/**
 * Blocking gate: students must provide an identity image (camera capture or
 * file upload) before joining a class or taking an assessment. Renders
 * children unchanged when the student already has an image or is not a
 * claimed student.
 */
export default function IdentityImageGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = useQuery(api.studentAssessments.getStudentViewer, {}) as
    | Viewer
    | undefined;
  const generateUploadUrl = useMutation(
    api.studentAssessments.generateIdentityUploadUrl,
  );
  const saveImage = useMutation(api.studentAssessments.saveIdentityImage);

  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => stopCamera, []);

  const needsImage =
    viewer !== undefined &&
    viewer !== null &&
    viewer.role === "student" &&
    viewer.claimed &&
    viewer.student !== null &&
    !viewer.student.hasIdentityImage;

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 720 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = s;
      setCamReady(false);
      setCapturing(true);
    } catch {
      toast.error(
        "Camera unavailable — allow camera access or use Upload Image instead.",
      );
    }
  };

  // Attach the stream once the <video> element mounts.
  useEffect(() => {
    if (capturing && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().then(
        () => setCamReady(true),
        () => setCamReady(true),
      );
    }
  }, [capturing]);

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = 640;
    const h = Math.round((video.videoHeight / video.videoWidth) * 640) || 640;
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return;
    // Un-mirror so the saved photo matches what others see.
    g.translate(w, 0);
    g.scale(-1, 1);
    g.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (b) => {
        if (b) {
          setPendingBlob(b);
          setPreview(URL.createObjectURL(b));
        }
      },
      "image/jpeg",
      0.9,
    );
    stopCamera();
    setCapturing(false);
  };

  const cancelCapture = () => {
    stopCamera();
    setCapturing(false);
  };

  const onFile = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    setPendingBlob(f);
    setPreview(URL.createObjectURL(f));
  };

  const doSave = async () => {
    if (!pendingBlob) return;
    setSaving(true);
    try {
      const url = await generateUploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": pendingBlob.type || "image/jpeg" },
        body: pendingBlob,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await saveImage({ storageId });
      toast.success("Identity image saved");
      setPendingBlob(null);
      setPreview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save image");
    } finally {
      setSaving(false);
    }
  };

  if (!needsImage) return <>{children}</>;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[10%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      <div className="clay relative z-10 w-full max-w-md p-8">
        <div className="flex items-center gap-2 font-bold">
          <GraduationCap className="size-5 text-primary" /> Identity required
        </div>
        <h1 className="mt-4 text-xl font-extrabold">Add your identity image</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Instructors verify identity against this photo. You must add it once
          before joining a class or taking an assessment.
        </p>

        {preview ? (
          <div className="mt-5 grid gap-3">
            <img
              src={preview}
              alt="Identity preview"
              className="mx-auto size-40 rounded-3xl border-4 border-white/60 object-cover shadow-md"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="clay-press flex-1 rounded-full"
                disabled={saving}
                onClick={() => {
                  setPendingBlob(null);
                  setPreview(null);
                }}
              >
                <RefreshCcw className="mr-1.5 size-4" /> Retake
              </Button>
              <Button
                className="clay-press flex-1 rounded-full"
                disabled={saving}
                onClick={() => void doSave()}
              >
                {saving ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <IdCard className="mr-1.5 size-4" />
                )}
                Save image
              </Button>
            </div>
          </div>
        ) : capturing ? (
          <div className="mt-5 grid gap-3">
            <div className="relative mx-auto overflow-hidden rounded-3xl border-4 border-white/60 shadow-md">
              <video
                ref={videoRef}
                playsInline
                muted
                className="block size-56 -scale-x-100 object-cover"
              />
              <div className="pointer-events-none absolute inset-4 rounded-[1.6rem] border-2 border-dashed border-white/50" />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="clay-press flex-1 rounded-full"
                onClick={cancelCapture}
              >
                Cancel
              </Button>
              <Button
                className="clay-press flex-1 rounded-full"
                disabled={!camReady}
                onClick={capture}
              >
                <Camera className="mr-1.5 size-4" /> Capture
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-2.5">
            <Button
              className="clay-press h-11 rounded-full"
              onClick={() => void startCamera()}
            >
              <Camera className="mr-2 size-4" /> Capture with Camera
            </Button>
            <Button
              variant="outline"
              className="clay-press h-11 rounded-full"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-2 size-4" /> Upload Image
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Saved securely to your account and only shared with your instructors.
        </p>
      </div>
    </main>
  );
}
