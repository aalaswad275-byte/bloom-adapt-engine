import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link } from "react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  CircleAlert,
  CircleCheck,
  IdCard,
  KeyRound,
  Loader2,
  RefreshCcw,
  ScanFace,
  ShieldCheck,
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
import {
  analyzeLiveFace,
  FACE_ISSUES,
  FACE_POSES,
  loadFaceApi,
  type FacePoseKey,
} from "@/lib/faceMatch";

type Viewer = {
  role: string | null;
  claimed: boolean;
  student: { id: string; name: string } | null;
} | null;

type Profile = {
  name: string;
  email: string | null;
  phone: string | null;
  studentIdNumber: string | null;
  institutionName: string | null;
  teachingCenterName: string | null;
  memberSince: number;
  identityImageUrl: string | null;
  identityImageAt: number | null;
  classesJoined: number;
  faceRegisteredAt: number | null;
  faceImageCount: number;
  lastFaceCheckAt: number | null;
  lastFaceCheckStatus: string | null;
};

type FaceStatus = {
  registered: boolean;
  faceRegisteredAt: number | null;
  imageCount: number;
  poses: string[];
  lastFaceCheckAt: number | null;
  lastFaceCheckStatus: string | null;
};

type PoseIssue =
  | "no_face"
  | "multiple_faces"
  | "too_far"
  | "too_close"
  | "off_center"
  | "poor_lighting";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const POSE_ICON: Record<FacePoseKey, React.ReactNode> = {
  center: <ScanFace className="size-4" />,
  slight_left: <ArrowLeft className="size-4" />,
  slight_right: <ArrowRight className="size-4" />,
  far_left: <ChevronsLeft className="size-4" />,
  far_right: <ChevronsRight className="size-4" />,
  slight_up: <ArrowUp className="size-4" />,
  slight_down: <ArrowDown className="size-4" />,
};

function fmtDate(ms: number | null): string {
  return ms === null ? "—" : new Date(ms).toLocaleString();
}

/** Student profile: personal info, face registration, verification status. */
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
  const faceStatus = useQuery(
    api.studentFaces.getMyFaceStatus,
    isAuthenticated && viewer?.claimed ? {} : "skip",
  ) as FaceStatus | undefined;

  const updateProfile = useMutation(api.studentAssessments.updateStudentProfile);
  const generateUploadUrl = useMutation(
    api.studentAssessments.generateIdentityUploadUrl,
  );
  const saveImage = useMutation(api.studentAssessments.saveIdentityImage);
  const generateFaceUploadUrl = useMutation(
    api.studentFaces.generateFaceUploadUrl,
  );
  const saveFaceImage = useMutation(api.studentFaces.saveFaceImage);
  const resetFaceRegistration = useMutation(
    api.studentFaces.resetFaceRegistration,
  );

  // ------------------------------------------------------------------
  // Personal details
  // ------------------------------------------------------------------
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [studentIdNumber, setStudentIdNumber] = useState<string | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);

  const currentName = name ?? profile?.name ?? "";
  const currentPhone = phone ?? profile?.phone ?? "";
  const currentIdNumber = studentIdNumber ?? profile?.studentIdNumber ?? "";
  const detailsDirty =
    profile !== undefined &&
    (currentName.trim() !== profile.name ||
      currentPhone.trim() !== (profile.phone ?? "") ||
      currentIdNumber.trim() !== (profile.studentIdNumber ?? ""));

  const doSaveDetails = async () => {
    if (!profile) return;
    setSavingDetails(true);
    try {
      const patch: {
        name?: string;
        phone?: string;
        studentIdNumber?: string;
      } = {};
      if (currentName.trim() !== profile.name) patch.name = currentName.trim();
      if (currentPhone.trim() !== (profile.phone ?? ""))
        patch.phone = currentPhone.trim();
      if (currentIdNumber.trim() !== (profile.studentIdNumber ?? ""))
        patch.studentIdNumber = currentIdNumber.trim();
      if (Object.keys(patch).length === 0) return;
      await updateProfile(patch);
      toast.success("Profile updated");
      setName(null);
      setPhone(null);
      setStudentIdNumber(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    } finally {
      setSavingDetails(false);
    }
  };

  // ------------------------------------------------------------------
  // Profile photo (identity image) capture / upload
  // ------------------------------------------------------------------
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
      toast.success("Profile photo updated");
      setPendingBlob(null);
      setPreview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save image");
    } finally {
      setSavingImage(false);
    }
  };

  // ------------------------------------------------------------------
  // Face registration: guided 7-pose auto-capture
  // ------------------------------------------------------------------
  const [faceCamOpen, setFaceCamOpen] = useState(false);
  const [regStep, setRegStep] = useState(0);
  const [regSaving, setRegSaving] = useState(false);
  const [regMsg, setRegMsg] = useState<string | null>(null);
  const faceVideoRef = useRef<HTMLVideoElement | null>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceStreamRef = useRef<MediaStream | null>(null);
  const faceBusyRef = useRef(false);
  const holdCountRef = useRef(0);

  const stopFaceCam = () => {
    faceStreamRef.current?.getTracks().forEach((t) => t.stop());
    faceStreamRef.current = null;
  };
  useEffect(() => stopFaceCam, []);

  const openFaceCam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 720 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      faceStreamRef.current = s;
      setRegStep(0);
      setRegMsg(null);
      holdCountRef.current = 0;
      setFaceCamOpen(true);
    } catch {
      toast.error(
        "Camera unavailable — allow camera access and try again.",
      );
    }
  };

  useEffect(() => {
    if (faceCamOpen && faceVideoRef.current && faceStreamRef.current) {
      faceVideoRef.current.srcObject = faceStreamRef.current;
      void faceVideoRef.current.play().catch(() => undefined);
    }
  }, [faceCamOpen]);

  /** Save the current pose with the descriptor captured alongside it. */
  const captureCurrentPose = async (descriptor: number[]) => {
    const pose = FACE_POSES[regStep];
    const video = faceVideoRef.current;
    const canvas = faceCanvasRef.current;
    if (!pose || !video || !canvas) return;
    const w = 640;
    const h = Math.round((video.videoHeight / video.videoWidth) * 640) || 640;
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return;
    // Un-mirror so stored images match what others see.
    g.translate(w, 0);
    g.scale(-1, 1);
    g.drawImage(video, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", 0.9),
    );
    if (!blob) {
      setRegMsg("Could not capture the image — try again.");
      return;
    }
    setRegSaving(true);
    try {
      const url = await generateFaceUploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const r = await saveFaceImage({
        storageId,
        pose: pose.key,
        embedding: descriptor,
      });
      if (r.complete || regStep >= FACE_POSES.length - 1) {
        setRegStep(FACE_POSES.length);
        setRegMsg(null);
        toast.success("Face registration complete");
        stopFaceCam();
        setFaceCamOpen(false);
      } else {
        setRegStep((s) => s + 1);
        setRegMsg(null);
        holdCountRef.current = 0;
      }
    } catch (err) {
      setRegMsg(err instanceof Error ? err.message : "Could not save — retry.");
    } finally {
      setRegSaving(false);
    }
  };

  // Auto-capture loop: detects the face, checks quality, and captures once
  // the requested pose has been held steady for ~1.5s.
  useEffect(() => {
    if (!faceCamOpen || regSaving || regStep >= FACE_POSES.length) return;
    let alive = true;
    const t = window.setInterval(async () => {
      const v = faceVideoRef.current;
      if (faceBusyRef.current || !v || v.readyState < 2 || v.videoWidth === 0)
        return;
      faceBusyRef.current = true;
      try {
        const faceapi = await loadFaceApi();
        const r = await analyzeLiveFace(faceapi, v);
        if (!alive) return;
        const target = FACE_POSES[regStep];
        if (!r.ok) {
          holdCountRef.current = 0;
          setRegMsg(FACE_ISSUES[r.issue as PoseIssue] ?? "Adjust and try again.");
          return;
        }
        if (r.pose === target.key) {
          holdCountRef.current += 1;
          setRegMsg(
            holdCountRef.current >= 2 ? "Capturing…" : "Hold still…",
          );
          if (holdCountRef.current >= 2) {
            holdCountRef.current = 0;
            await captureCurrentPose(r.descriptor);
          }
        } else {
          holdCountRef.current = 0;
          setRegMsg(target.hint);
        }
      } catch {
        if (alive) setRegMsg("Detection engine loading…");
      } finally {
        faceBusyRef.current = false;
      }
    }, 700);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceCamOpen, regStep, regSaving]);

  const doResetFace = async () => {
    if (
      !confirm(
        "Retake face registration? All previously captured poses will be replaced.",
      )
    )
      return;
    try {
      await resetFaceRegistration({});
      toast.success("Previous registration cleared");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset");
    }
  };

  // ------------------------------------------------------------------
  // Loading / access states
  // ------------------------------------------------------------------
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

  const regDone = (faceStatus?.poses.length ?? 0) >= FACE_POSES.length;

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
        <div className="flex items-center gap-3">
          <Link to="/change-password" className="hidden sm:block">
            <Button variant="outline" className="clay-press rounded-full">
              <KeyRound className="mr-1.5 size-4" /> Change password
            </Button>
          </Link>
          <Badge className="clay-inset rounded-full text-xs text-foreground">
            {profile.classesJoined} class{profile.classesJoined === 1 ? "" : "es"}
          </Badge>
        </div>
      </header>

      <section className="relative z-10 mx-auto mt-6 w-full max-w-5xl px-6">
        {/* --- Personal information --- */}
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* Profile photo card */}
          <div className="clay h-fit p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <IdCard className="size-4 text-primary" /> Profile photo
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Shown to instructors on rosters. Face registration images are
              captured separately below.
            </p>

            {preview ? (
              <div className="mt-4 grid gap-3">
                <img
                  src={preview}
                  alt="Profile preview"
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
                    alt="Profile"
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
              <UserRound className="size-4 text-primary" /> Personal information
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Your name and student ID are shown to instructors on rosters and
              results.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
                <Label className="text-xs font-semibold">Student ID</Label>
                <Input
                  className="clay-inset rounded-full px-4"
                  value={currentIdNumber}
                  onChange={(e) => setStudentIdNumber(e.target.value)}
                  placeholder="e.g. STU-2024-018"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Phone number</Label>
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
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Institution</Label>
                <Input
                  className="clay-inset rounded-full px-4 text-muted-foreground"
                  value={profile.institutionName ?? "Not set"}
                  disabled
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Teaching center</Label>
                <Input
                  className="clay-inset rounded-full px-4 text-muted-foreground"
                  value={profile.teachingCenterName ?? "Not set"}
                  disabled
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Email is your sign-in identity — institution and teaching
                center are set by administrators.
              </p>
              <Button
                className="clay-press shrink-0 rounded-full"
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

        {/* --- Face registration + verification status --- */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div id="face" className="clay scroll-mt-6 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ScanFace className="size-4 text-primary" /> Face registration
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Capture your face from 7 angles. The camera auto-captures each
              pose once it is held steady. Images are stored securely with
              your account and never shown to instructors.
            </p>

            {/* Pose progress */}
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {FACE_POSES.map((p, i) => {
                const captured = faceStatus?.poses.includes(p.key) ?? false;
                const active = faceCamOpen && i === regStep;
                return (
                  <span
                    key={p.key}
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      active
                        ? "bg-[var(--primary)] text-white"
                        : captured
                          ? "bg-[oklch(0.72_0.14_145)]/15 text-[oklch(0.45_0.12_145)]"
                          : "clay-inset text-muted-foreground"
                    }`}
                  >
                    {captured ? (
                      <Check className="size-3" />
                    ) : (
                      POSE_ICON[p.key]
                    )}
                    {p.label}
                  </span>
                );
              })}
            </div>

            {faceCamOpen && regStep < FACE_POSES.length ? (
              <div className="mt-4 grid gap-3">
                <div className="relative mx-auto overflow-hidden rounded-3xl border-4 border-white/60 shadow-md">
                  <video
                    ref={faceVideoRef}
                    playsInline
                    muted
                    className="block h-64 w-72 -scale-x-100 object-cover"
                  />
                  <div className="pointer-events-none absolute inset-4 rounded-[1.6rem] border-2 border-dashed border-white/50" />
                  <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-white">
                    {regStep + 1} / {FACE_POSES.length}
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2 text-sm font-bold">
                  {POSE_ICON[FACE_POSES[regStep].key]}
                  {FACE_POSES[regStep].label}
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  {regMsg ?? FACE_POSES[regStep].hint}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="clay-press flex-1 rounded-full"
                    disabled={regSaving}
                    onClick={() => {
                      stopFaceCam();
                      setFaceCamOpen(false);
                      setRegMsg(null);
                    }}
                  >
                    Pause
                  </Button>
                  <Button
                    className="clay-press flex-1 rounded-full"
                    disabled={regSaving}
                    onClick={() => {
                      // Manual fallback: capture whatever face is visible.
                      const v = faceVideoRef.current;
                      if (!v) return;
                      void (async () => {
                        try {
                          const faceapi = await loadFaceApi();
                          const r = await analyzeLiveFace(faceapi, v);
                          if (!r.ok) {
                            setRegMsg(
                              FACE_ISSUES[r.issue as PoseIssue] ??
                                "Adjust and try again.",
                            );
                            return;
                          }
                          await captureCurrentPose(r.descriptor);
                        } catch {
                          setRegMsg("Detection engine loading…");
                        }
                      })();
                    }}
                  >
                    {regSaving ? (
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                    ) : (
                      <Camera className="mr-1.5 size-4" />
                    )}
                    Capture now
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  className="clay-press rounded-full"
                  onClick={() => void openFaceCam()}
                >
                  <Camera className="mr-2 size-4" />
                  {regDone ? "Retake registration" : "Start registration"}
                </Button>
                {regDone && (
                  <Button
                    variant="outline"
                    className="clay-press rounded-full"
                    onClick={() => void doResetFace()}
                  >
                    <RefreshCcw className="mr-2 size-4" /> Reset all poses
                  </Button>
                )}
              </div>
            )}

            <canvas ref={faceCanvasRef} className="hidden" />
          </div>

          {/* Verification status */}
          <div className="clay h-fit p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-primary" /> Verification
              status
            </div>
            <div className="mt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Registration</span>
                {faceStatus?.registered ? (
                  <span className="flex items-center gap-1 font-bold text-[oklch(0.45_0.12_145)]">
                    <CircleCheck className="size-3.5" /> Complete
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-bold text-amber-600">
                    <CircleAlert className="size-3.5" /> Incomplete
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Registered poses</span>
                <span className="font-bold tabular-nums">
                  {faceStatus?.imageCount ?? 0} / {FACE_POSES.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last verification</span>
                <span className="font-bold">
                  {faceStatus?.lastFaceCheckStatus === "passed" ? (
                    <span className="text-[oklch(0.45_0.12_145)]">Passed</span>
                  ) : faceStatus?.lastFaceCheckStatus === "failed" ? (
                    <span className="text-destructive">Failed</span>
                  ) : (
                    <span className="text-muted-foreground">Not yet</span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Checked at</span>
                <span className="font-bold">
                  {fmtDate(faceStatus?.lastFaceCheckAt ?? null)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Registered on</span>
                <span className="font-bold">
                  {fmtDate(faceStatus?.faceRegisteredAt ?? null)}
                </span>
              </div>
            </div>
            <p className="mt-4 text-[11px] text-muted-foreground">
              Identity is verified live before every assessment. Instructors
              see this status only — never your facial images or data.
            </p>
          </div>
        </div>

        <div className="h-10" />
      </section>
    </main>
  );
}
