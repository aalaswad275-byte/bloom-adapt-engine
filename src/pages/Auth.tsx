import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2, Mail, User } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const { isLoading, isAuthenticated } = useAuth();
  const { signIn } = useAuthActions();
  const navigate = useNavigate();

  // Redirect already-authenticated users
  if (isAuthenticated && isLoading === false) {
    const dest = returnTo || "/dashboard";
    return <Navigate to={dest} replace />;
  }

  // Read returnTo from query params once mounted
  if (returnTo === null) {
    const param = searchParams.get("returnTo");
    setReturnTo(param || null);
  }

  async function handleEmailOtp() {
    if (!email.trim()) return;
    await signIn("emailOtp", { email: email.trim() });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <User className="size-6 text-muted-foreground" />
            </div>
          </div>
          <CardTitle className="text-xl">Sign in to AdaptiveMind</CardTitle>
          <CardDescription>
            Enter your email to receive a one-time sign-in link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleEmailOtp();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={!email.trim() || isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send sign-in link"
              )}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 text-center text-xs text-muted-foreground">
          <p>
            By continuing, you agree to our terms of service and privacy
            policy.
          </p>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">Back to home</Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
