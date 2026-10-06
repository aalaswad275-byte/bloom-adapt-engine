import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { useConvex, useMutation } from "convex/react";
import { Loader2, Mail, Lock, Command, Apple, LogIn, AlertCircle, User, ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

type AuthMode = "login" | "register" | "forgot";
type OtpStep = "email" | "code";
/** What the pending emailed code is for. */
type OtpContext = "signin" | "register" | "reset" | "password-login";

function friendlyAuthError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(msg);
    if (parsed && typeof parsed === "object") {
      return parsed.message || parsed.error || parsed.detail || fallback;
    }
  } catch {
    if (/network|fetch|connect/i.test(msg)) {
      return "Unable to reach the sign-in service. Please check your connection and try again.";
    }
    if (/api|key|unauthorized/i.test(msg)) {
      return "Sign-in service is not configured properly. Please try again later.";
    }
  }
  return msg || fallback;
}

export default function AuthPage() {
  const [activeTab, setActiveTab] = useState<string>("code");
  const [mode, setMode] = useState<AuthMode>("login");
  const [otpStep, setOtpStep] = useState<OtpStep>("email");
  const [otpContext, setOtpContext] = useState<OtpContext>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  /** Password saved right after the emailed code completes sign-in. */
  const [pendingPassword, setPendingPassword] = useState<{
    password: string;
    name?: string;
    kind: "register" | "reset";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  const { isLoading, isAuthenticated } = useAuth();
  const { signIn } = useAuthActions();
  const convex = useConvex();
  const setMyPassword = useMutation(api.passwordAuth.setMyPassword);
  const navigate = useNavigate();

  // Read returnTo from query params once mounted
  useEffect(() => {
    setReturnTo(searchParams.get("returnTo") || null);
  }, [searchParams]);

  // After the emailed code completes sign-in, finish register/reset flows by
  // saving the password on the now-authenticated user.
  useEffect(() => {
    if (!isAuthenticated || !pendingPassword) return;
    const pending = pendingPassword;
    setMyPassword({ password: pending.password, name: pending.name })
      .then((result) => {
        if (result.success) {
          setSuccess(
            pending.kind === "register"
              ? "Account created — you're signed in!"
              : "Password updated — you're signed in!",
          );
        } else {
          setError(result.error ?? "Signed in, but your password could not be saved. You can reset it later.");
        }
      })
      .catch(() => {
        setError("Signed in, but your password could not be saved. You can reset it later.");
      })
      .finally(() => setPendingPassword(null));
  }, [isAuthenticated, pendingPassword, setMyPassword]);

  // Redirect already-authenticated users
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate(returnTo ?? "/dashboard", { replace: true });
    }
  }, [isAuthenticated, isLoading, returnTo, navigate]);

  function resetOtpState(context: OtpContext) {
    setOtpContext(context);
    setOtpStep("code");
    setOtpCode("");
  }

  async function handleEmailOtpRequest() {
    if (!email.trim()) return;
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await signIn("email-otp", { email: email.trim() });
      resetOtpState("signin");
      setSuccess("Verification code sent to your email");
    } catch (err) {
      setError(friendlyAuthError(err, "Failed to send verification code. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleOtpVerification() {
    if (otpCode.length !== 6) return;
    if (otpContext === "reset" && newPassword.length < 8) {
      setError("Choose a new password (at least 8 characters)");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await signIn("email-otp", { email: email.trim(), code: otpCode.trim() });
      if (otpContext === "register") {
        setPendingPassword({ password, name: name.trim() || undefined, kind: "register" });
        setSuccess("Signed in — saving your account details…");
      } else if (otpContext === "reset") {
        setPendingPassword({ password: newPassword, kind: "reset" });
        setSuccess("Signed in — updating your password…");
      } else {
        setSuccess("Signed in successfully!");
      }
      // Redirect to the app happens via the auth effect above
    } catch (err) {
      setError(friendlyAuthError(err, "Invalid verification code. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordLogin() {
    if (!email.trim() || !password) return;
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const result = await convex.query(api.passwordAuth.verifyPassword, {
        email: email.trim(),
        password,
      });
      if (result.status === "invalid") {
        setError("Invalid email or password. Please try again.");
        return;
      }
      if (result.status === "no_password") {
        setError("This account doesn't have a password yet — sign in with a verification code instead.");
        return;
      }
      // Password OK: the emailed code completes the sign-in
      await signIn("email-otp", { email: email.trim() });
      resetOtpState("password-login");
      setActiveTab("code");
      setSuccess("Password verified — enter the code we just emailed to finish signing in");
    } catch (err) {
      setError(friendlyAuthError(err, "Invalid email or password. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordRegister() {
    if (!email.trim() || password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const status = await convex.query(api.passwordAuth.getAccountStatus, {
        email: email.trim(),
      });
      if (status.exists && status.hasPassword) {
        setError("An account with this email already exists — sign in instead.");
        return;
      }
      await signIn("email-otp", { email: email.trim() });
      resetOtpState("register");
      setActiveTab("code");
      setSuccess("Verification code sent — enter it to create your account");
    } catch (err) {
      setError(friendlyAuthError(err, "Failed to create account. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) return;
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await signIn("email-otp", { email: email.trim() });
      resetOtpState("reset");
      setActiveTab("code");
      setNewPassword("");
      setSuccess("Reset code sent — enter it with your new password below");
    } catch (err) {
      setError(friendlyAuthError(err, "Failed to send the reset code. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await signIn("email-otp", { email: email.trim() });
      setSuccess("New code sent to your email");
    } catch (err) {
      setError(friendlyAuthError(err, "Failed to resend the code. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function handleTabChange(value: string) {
    setActiveTab(value);
    setError(null);
    setSuccess(null);
    if (value === "code") {
      setOtpStep("email");
      setOtpContext("signin");
      setOtpCode("");
    }
    if (value === "password") {
      setMode("login");
      setPassword("");
    }
  }

  function backToSignIn() {
    setMode("login");
    setOtpStep("email");
    setOtpContext("signin");
    setOtpCode("");
    setPassword("");
    setNewPassword("");
    setError(null);
    setSuccess(null);
  }

  const working = busy || isLoading;

  const codeStepHint =
    otpContext === "register"
      ? "Enter the code to finish creating your account"
      : otpContext === "reset"
        ? "Enter the code, then choose a new password"
        : otpContext === "password-login"
          ? "Password verified — enter the code to finish signing in"
          : "Enter the code sent to your email";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
              <User className="size-7 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Sign in to AdaptiveMind</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {activeTab === "code" && otpStep === "email"
              ? "Enter your email to receive a verification code"
              : activeTab === "code"
                ? codeStepHint
                : mode === "forgot"
                  ? "We'll email you a code to reset your password"
                  : "Choose how you want to sign in"}
          </p>
        </div>

        {/* Auth Methods Tabs */}
        <Card className="border-0 shadow-lg">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <CardHeader className="pb-0">
              <CardTitle className="text-lg">Sign in method</CardTitle>
              <CardDescription>Select how you'd like to access your account</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <TabsList className="grid grid-cols-2 gap-2 mb-6">
                <TabsTrigger value="code" className="flex items-center gap-2">
                  <Mail className="size-4" />
                  Verification Code
                </TabsTrigger>
                <TabsTrigger value="password" className="flex items-center gap-2">
                  <Lock className="size-4" />
                  Email & Password
                </TabsTrigger>
              </TabsList>

              {/* Verification Code Tab */}
              <TabsContent value="code" className="space-y-4">
                {error && (
                  <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive text-sm rounded-md">
                    <AlertCircle className="size-4" />
                    {error}
                  </div>
                )}
                {success && (
                  <div className="flex items-center gap-2 p-3 bg-green-500/10 text-green-600 text-sm rounded-md">
                    <LogIn className="size-4" />
                    {success}
                  </div>
                )}

                {otpStep === "email" ? (
                  <form onSubmit={(e) => { e.preventDefault(); handleEmailOtpRequest(); }} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="code-email">Email address</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="code-email"
                          type="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-9"
                          required
                        />
                      </div>
                    </div>
                    <Button type="submit" className="w-full" disabled={!email.trim() || working}>
                      {busy ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        "Send Verification Code"
                      )}
                    </Button>
                  </form>
                ) : (
                  <form onSubmit={(e) => { e.preventDefault(); handleOtpVerification(); }} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Verification Code</Label>
                      <InputOTP
                        value={otpCode}
                        onChange={(value) => setOtpCode(value)}
                        maxLength={6}
                        className="w-full"
                      >
                        <InputOTPGroup>
                          {[...Array(6)].map((_, i) => (
                            <InputOTPSlot key={i} index={i} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                      <p className="text-xs text-muted-foreground">
                        Enter the 6-digit code sent to {email}
                      </p>
                    </div>

                    {otpContext === "reset" && (
                      <div className="space-y-2">
                        <Label htmlFor="new-password">New password</Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="new-password"
                            type="password"
                            placeholder="At least 8 characters"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="pl-9"
                            required
                            minLength={8}
                          />
                        </div>
                      </div>
                    )}

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={otpCode.length !== 6 || working || (otpContext === "reset" && newPassword.length < 8)}
                    >
                      {busy ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Verifying...
                        </>
                      ) : otpContext === "reset" ? (
                        "Update Password"
                      ) : (
                        "Verify Code"
                      )}
                    </Button>
                    <div className="text-center">
                      <Button variant="link" type="button" onClick={resendCode} className="text-sm">
                        <ArrowLeft className="mr-1 size-3" />
                        Didn't receive code? Resend
                      </Button>
                    </div>
                  </form>
                )}
              </TabsContent>

              {/* Email & Password Tab */}
              <TabsContent value="password" className="space-y-4">
                {error && (
                  <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive text-sm rounded-md">
                    <AlertCircle className="size-4" />
                    {error}
                  </div>
                )}
                {success && (
                  <div className="flex items-center gap-2 p-3 bg-green-500/10 text-green-600 text-sm rounded-md">
                    <LogIn className="size-4" />
                    {success}
                  </div>
                )}

                {/* Mode Toggle */}
                <div className="flex gap-2">
                  <Button
                    variant={mode === "login" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setMode("login")}
                  >
                    Sign In
                  </Button>
                  <Button
                    variant={mode === "register" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setMode("register")}
                  >
                    Create Account
                  </Button>
                </div>

                {mode === "forgot" ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Enter your email and we'll send you a 6-digit code to reset your password.
                    </p>
                    <form onSubmit={(e) => { e.preventDefault(); handleForgotPassword(); }} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="forgot-email">Email address</Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="forgot-email"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="pl-9"
                            required
                          />
                        </div>
                      </div>
                      <Button type="submit" className="w-full" disabled={!email.trim() || working}>
                        {busy ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          "Send Reset Code"
                        )}
                      </Button>
                    </form>
                    <Button variant="ghost" className="w-full" onClick={backToSignIn}>
                      Back to sign in
                    </Button>
                  </>
                ) : (
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    if (mode === "login") handlePasswordLogin();
                    else handlePasswordRegister();
                  }} className="space-y-4">
                    {mode === "register" && (
                      <div className="space-y-2">
                        <Label htmlFor="reg-name">Full name (optional)</Label>
                        <Input
                          id="reg-name"
                          type="text"
                          placeholder="John Doe"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="pwd-email">Email address</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="pwd-email"
                          type="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-9"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="pwd-password">Password</Label>
                        {mode === "register" && (
                          <span className="text-xs text-muted-foreground">Min. 8 characters</span>
                        )}
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="pwd-password"
                          type="password"
                          placeholder="Enter your password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-9"
                          required
                          minLength={mode === "register" ? 8 : undefined}
                        />
                      </div>
                    </div>

                    {mode === "login" && (
                      <div className="flex justify-end">
                        <Button
                          variant="link"
                          type="button"
                          onClick={() => setMode("forgot")}
                          className="text-sm"
                        >
                          Forgot password?
                        </Button>
                      </div>
                    )}

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={
                        !email.trim() ||
                        (!password && mode !== "register") ||
                        (mode === "register" && password.length < 8) ||
                        working
                      }
                    >
                      {busy ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          {mode === "login" ? "Signing in..." : "Creating account..."}
                        </>
                      ) : mode === "login" ? (
                        "Sign In"
                      ) : (
                        "Create Account"
                      )}
                    </Button>

                    {mode === "login" && (
                      <p className="text-center text-xs text-muted-foreground">
                        We'll email you a one-time code to confirm it's you.
                      </p>
                    )}
                  </form>
                )}
              </TabsContent>
            </CardContent>
          </Tabs>

          {/* Divider */}
          <CardFooter className="flex flex-col gap-3 pt-4">
            <div className="relative flex pt-4">
              <div className="absolute inset-0 flex items-center">
                <Separator />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            {/* Social Login Buttons — disabled until the providers are wired up */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="w-full"
                disabled
                title="Google sign-in isn't set up on this deployment yet"
              >
                <Command className="mr-2 size-4" />
                Continue with Google
              </Button>
              <Button
                variant="outline"
                className="w-full"
                disabled
                title="Apple sign-in isn't set up on this deployment yet"
              >
                <Apple className="mr-2 size-4" />
                Continue with Apple
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Google &amp; Apple sign-in are coming soon.
            </p>
          </CardFooter>
        </Card>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing, you agree to our{" "}
          <Link to="/terms" className="underline hover:text-foreground">Terms of Service</Link>
          {" "}and{" "}
          <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>
          .
        </p>
        <div className="mt-4 text-center">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
