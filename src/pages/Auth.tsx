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
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2, Mail, Lock, Command, Apple, LogIn, AlertCircle, User, ArrowLeft } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";

type AuthMode = "login" | "register" | "forgot";
type OtpStep = "email" | "code";

export default function AuthPage() {
  const [activeTab, setActiveTab] = useState<string>("code");
  const [mode, setMode] = useState<AuthMode>("login");
  const [otpStep, setOtpStep] = useState<OtpStep>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { isLoading, isAuthenticated } = useAuth();
  const { signIn } = useAuthActions();
  const navigate = useNavigate();

  // Redirect already-authenticated users
  useEffect(() => {
    if (isAuthenticated && !isLoading && returnTo) {
      navigate(returnTo, { replace: true });
    } else if (isAuthenticated && !isLoading) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, isLoading, returnTo, navigate]);

  // Read returnTo from query params once mounted
  useEffect(() => {
    const param = searchParams.get("returnTo");
    setReturnTo(param || null);
  }, [searchParams]);

  async function handleEmailOtpRequest() {
    if (!email.trim()) return;
    setError(null);
    setSuccess(null);
    try {
      await signIn("email-otp", { email: email.trim() });
      setOtpStep("code");
      setSuccess("Verification code sent to your email");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      try {
        const parsed = JSON.parse(errorMsg);
        setError(
          parsed.message ||
          parsed.error ||
          parsed.detail ||
          (typeof parsed === 'object' ? JSON.stringify(parsed) : errorMsg)
        );
      } catch {
        if (errorMsg.includes('network') || errorMsg.includes('fetch') || errorMsg.includes('connect')) {
          setError("Unable to reach the sign-in service. Please check your connection and try again.");
        } else if (errorMsg.includes('api') || errorMsg.includes('key') || errorMsg.includes('unauthorized')) {
          setError("Sign-in service is not configured properly. Please contact support.");
        } else {
          setError(errorMsg || "Failed to send verification code. Please try again.");
        }
      }
    }
  }

  async function handleOtpVerification() {
    if (!otpCode.trim()) return;
    setError(null);
    try {
      // Convex Auth handles OTP verification automatically when signing in with email-otp
      // The code is verified through the auth flow
      await signIn("email-otp", { email: email.trim(), code: otpCode.trim() });
      setSuccess("Signed in successfully!");
      // User will be redirected by the useEffect above
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg || "Invalid verification code. Please try again.");
    }
  }

  async function handlePasswordLogin() {
    if (!email.trim() || !password) return;
    setError(null);
    try {
      await signIn("credentials", { email: email.trim(), password });
    } catch (err) {
      setError("Invalid email or password. Please try again.");
    }
  }

  async function handlePasswordRegister() {
    if (!email.trim() || !password || password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError(null);
    try {
      await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() || undefined }),
      }).then((r) => r.json()).then((data) => {
        if (!data.success) throw new Error(data.error || "Registration failed");
      });

      await signIn("email-otp", { email: email.trim() });
      setOtpStep("code");
      setSuccess("Account created! Verification code sent to your email");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account. Please try again.");
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) return;
    setError(null);
    setSuccess(null);
    try {
      const result = await fetch("/api/auth/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      }).then((r) => r.json());

      setSuccess(result.message || "If an account exists, a reset link has been sent");
    } catch (err) {
      setError("Failed to request password reset. Please try again.");
    }
  }

  function handleGoogleLogin() {
    signIn("google").catch((err) => {
      setError("Google sign-in failed. Please try again.");
    });
  }

  function handleAppleLogin() {
    signIn("apple").catch((err) => {
      setError("Apple sign-in failed. Please try again.");
    });
  }

  function resendCode() {
    setOtpStep("email");
    setOtpCode("");
    setError(null);
    setSuccess(null);
  }

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
            {activeTab === "code" && otpStep === "email" ? "Enter your email to receive a verification code" : 
             activeTab === "code" && otpStep === "code" ? "Enter the verification code sent to your email" :
             "Choose how you want to sign in"}
          </p>
        </div>

        {/* Auth Methods Tabs */}
        <Card className="border-0 shadow-lg">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
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
                  <>
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
                      <Button type="submit" className="w-full" disabled={!email.trim() || isLoading}>
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          "Send Verification Code"
                        )}
                      </Button>
                    </form>
                  </>
                ) : (
                  <>
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
                      <Button type="submit" className="w-full" disabled={!otpCode.trim() || isLoading}>
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Verifying...
                          </>
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
                  </>
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
                      Enter your email and we'll send you a link to reset your password.
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
                      <Button type="submit" className="w-full" disabled={!email.trim() || isLoading}>
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          "Send Reset Link"
                        )}
                      </Button>
                    </form>
                    <Button variant="ghost" className="w-full" onClick={() => setMode("login")}>
                      Back to sign in
                    </Button>
                  </>
                ) : (
                  <>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      mode === "login" ? handlePasswordLogin() : handlePasswordRegister();
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
                          isLoading
                        }
                      >
                        {isLoading ? (
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
                    </form>
                  </>
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

            {/* Social Login Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleGoogleLogin}
                disabled={isLoading}
              >
                <Command className="mr-2 size-4" />
                Continue with Google
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleAppleLogin}
                disabled={isLoading}
              >
                <Apple className="mr-2 size-4" />
                Continue with Apple
              </Button>
            </div>
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
