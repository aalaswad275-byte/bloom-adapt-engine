import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link } from "react-router";
import {
  ArrowLeft,
  Camera,
  Check,
  IdCard,
  Loader2,
  RefreshCcw,
  Upload,
  UserRound,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";

type Viewer = {
  role: string | null;
  claimed: boolean;
  student: { id: string; name: string } | null;
} | null;

type Profile = {
  name: string;
  email: string | null;
  phone: string | null;
  memberSince: number;
  identityImageUrl: string | null;
  identityImageAt: number | null;
  classesJoined: number;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Student profile: edit details and upload/replace the identity image. */
export default function StudentProfile() {
  const { isLoading, isAuthenticated } = useAuth();
  const viewer = useQuery(
    api.studentAssessments.getStudentViewer,
    isAuthenticated ? {} : "skip",
  ) as Viewer | undefined;
  const profile = useQuery(
    api.studentAssessments.getMyProfile,
    isAuthenticated && viewer?.claimed ? {} : "skip",
  ) as Profile | undefined;

  const updateProfile = useMutation(api.studentAssessments.updateStudentProfile);
  const generateUploadUrl = useMutation(
    api.studentAssessments.generateIdentityUploadUrl,
  );
  const saveImage = useMutation(api.studentAssessments.saveIdentityImage);

  // --- Details form ---
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);

  const currentName = name ?? profile?.name ?? "";
  const currentPhone = phone ?? profile?.phone ?? "";
  const detailsDirty =
    profile !== undefined &&
    (currentName.trim() !== profile.name ||
      currentPhone.trim() !== (profile.phone ?? ""));

  const doSaveDetails = async () => {
    if (!profile) return;
    setSavingDetails(true);
    try {
      const patch: { name?: string; phone?: string } = {};
      if (currentName.trim() !== profile.name) patch.name = currentName.trim();
      if (currentPhone.trim() !== (profile.phone ?? ""))
        patch.phone = currentPhone.trim();
      if (Object.keys(patch).length === 0) return;
      await updateProfile(patch);
      toast.success("Profile updated");
      setName(null);
      setPhone(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    } finally {
      setSavingDetails(false);
    }
  };

  // --- Identity image capture / upload (same flow as the onboarding gate) ---
  const [capturing, setCapturing] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => stopCamera, []);

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

  const doSaveImage = async () => {
    if (!pendingBlob) return;
    setSavingImage(true);
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
      toast.success("Identity image updated");
      setPendingBlob(null);
      setPreview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save image");
    } finally {
      setSavingImage(false);
    }
  };

  if (isLoading || viewer === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-md p-8 text-center">
          <h1 className="text-xl font-bold">Sign in required</h1>
          <Link to="/auth?returnTo=%2Fprofile" className="mt-5 inline-block">
            <Button className="rounded-full">Sign in</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!viewer?.claimed || profile === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-md p-8 text-center">
          <UserRound className="mx-auto size-8 text-primary" />
          <h1 className="mt-3 text-xl font-bold">Student profile</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This page is for students. Sign in with a student account to view
            and edit your profile.
          </p>
          <Link to="/my-class" className="mt-5 inline-block">
            <Button variant="outline" className="rounded-full">
              <ArrowLeft className="mr-1.5 size-4" /> Back to my class
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[10%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-6 pt-8">
        <div className="flex items-center gap-3">
          <Link to="/my-class">
            <Button
              variant="outline"
              size="icon"
              className="clay-press rounded-full"
            >
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <p className="text-sm font-bold leading-tight">My profile</p>
            <p className="text-xs text-muted-foreground">
              {profile.email ?? "Student account"}
            </p>
          </div>
        </div>
        <Badge className="clay-inset rounded-full text-xs text-foreground">
          {profile.classesJoined} class{profile.classesJoined === 1 ? "" : "es"}
        </Badge>
      </header>

      <section className="relative z-10 mx-auto mt-6 w-full max-w-5xl px-6">
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* Identity image card */}
          <div className="clay h-fit p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <IdCard className="size-4 text-primary" /> Identity image
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Instructors verify your identity against this photo before
              assessments.
            </p>

            {preview ? (
              <div className="mt-4 grid gap-3">
                <img
                  src={preview}
                  alt="Identity preview"
                  className="mx-auto size-44 rounded-3xl border-4 border-white/60 object-cover shadow-md"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="clay-press flex-1 rounded-full"
                    disabled={savingImage}
                    onClick={() => {
                      setPendingBlob(null);
                      setPreview(null);
                    }}
                  >
                    <RefreshCcw className="mr-1.5 size-4" /> Retake
                  </Button>
                  <Button
                    className="clay-press flex-1 rounded-full"
                    disabled={savingImage}
                    onClick={() => void doSaveImage()}
                  >
                    {savingImage ? (
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                    ) : (
                      <Check className="mr-1.5 size-4" />
                    )}
                    Save
                  </Button>
                </div>
              </div>
            ) : capturing ? (
              <div className="mt-4 grid gap-3">
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
              <div className="mt-4 grid gap-3">
                {profile.identityImageUrl ? (
                  <img
                    src={profile.identityImageUrl}
                    alt="Identity"
                    className="mx-auto size-44 rounded-3xl border-4 border-white/60 object-cover shadow-md"
                  />
                ) : (
                  <div className="clay-inset mx-auto flex size-44 items-center justify-center rounded-3xl">
                    <span className="text-2xl font-extrabold text-muted-foreground">
                      {initials(profile.name) || "?"}
                    </span>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="clay-press flex-1 rounded-full"
                    onClick={() => void startCamera()}
                  >
                    <Camera className="mr-1.5 size-4" /> Camera
                  </Button>
                  <Button
                    variant="outline"
                    className="clay-press flex-1 rounded-full"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="mr-1.5 size-4" /> Upload
                  </Button>
                </div>
              </div>
            )}

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
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Details card */}
          <div className="clay h-fit p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <UserRound className="size-4 text-primary" /> Details
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Your name is shown to instructors on rosters and results.
            </p>

            <div className="mt-5 grid gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Full name</Label>
                <Input
                  className="clay-inset rounded-full px-4"
                  value={currentName}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Phone</Label>
                <Input
                  className="clay-inset rounded-full px-4"
                  value={currentPhone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Add a phone number"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Email</Label>
                <Input
                  className="clay-inset rounded-full px-4 text-muted-foreground"
                  value={profile.email ?? ""}
                  disabled
                />
                <p className="text-[11px] text-muted-foreground">
                  Email is your sign-in identity and cannot be changed here.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Member since{" "}
                  {new Date(profile.memberSince).toLocaleDateString()}
                </p>
                <Button
                  className="clay-press rounded-full"
                  disabled={!detailsDirty || savingDetails}
                  onClick={() => void doSaveDetails()}
                >
                  {savingDetails ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 size-4" />
                  )}
                  Save changes
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="h-10" />
      </section>
    </main>
  );
}
