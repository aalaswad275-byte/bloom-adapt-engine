import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Exam = lazy(() => import("./pages/Exam.tsx"));
const Results = lazy(() => import("./pages/Results.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Admin console (role-gated at /admin)
const AdminLayout = lazy(() => import("@/components/admin/AdminLayout"));
const RequireAdmin = lazy(() =>
  import("@/components/admin/AdminLayout").then((m) => ({
    default: m.RequireAdmin,
  })),
);
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard.tsx"));
const AdminInstitutions = lazy(() => import("./pages/admin/Institutions.tsx"));
const AdminInstitutionDetail = lazy(
  () => import("./pages/admin/InstitutionDetail.tsx"),
);
const AdminTeachingCenters = lazy(
  () => import("./pages/admin/TeachingCenters.tsx"),
);
const AdminGovernmentFacilities = lazy(
  () => import("./pages/admin/GovernmentFacilities.tsx"),
);
const AdminInstructors = lazy(() => import("./pages/admin/Instructors.tsx"));
const AdminInstructorPerformance = lazy(
  () => import("./pages/admin/InstructorPerformance.tsx"),
);
const AdminStudents = lazy(() => import("./pages/admin/Students.tsx"));
const AdminStudentPerformance = lazy(
  () => import("./pages/admin/StudentPerformance.tsx"),
);
const AdminAssessments = lazy(() => import("./pages/admin/Assessments.tsx"));
const AdminResults = lazy(() => import("./pages/admin/Results.tsx"));
const AdminAnalytics = lazy(() => import("./pages/admin/Analytics.tsx"));
const AdminReports = lazy(() => import("./pages/admin/Reports.tsx"));
const AdminAuditLogs = lazy(() => import("./pages/admin/AuditLogs.tsx"));
const AdminSettings = lazy(() => import("./pages/admin/Settings.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route
                path="/exam/:examId"
                element={
                  <RequireAuth>
                    <Exam />
                  </RequireAuth>
                }
              />
              <Route
                path="/results/:sessionId"
                element={
                  <RequireAuth>
                    <Results />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin"
                element={
                  <RequireAdmin>
                    <AdminLayout />
                  </RequireAdmin>
                }
              >
                <Route index element={<AdminDashboard />} />
                <Route path="institutions" element={<AdminInstitutions />} />
                <Route
                  path="institutions/:id"
                  element={<AdminInstitutionDetail />}
                />
                <Route
                  path="teaching-centers"
                  element={<AdminTeachingCenters />}
                />
                <Route
                  path="government-facilities"
                  element={<AdminGovernmentFacilities />}
                />
                <Route path="instructors" element={<AdminInstructors />} />
                <Route
                  path="instructors/:id/performance"
                  element={<AdminInstructorPerformance />}
                />
                <Route path="students" element={<AdminStudents />} />
                <Route
                  path="students/:id/performance"
                  element={<AdminStudentPerformance />}
                />
                <Route path="assessments" element={<AdminAssessments />} />
                <Route path="results" element={<AdminResults />} />
                <Route path="analytics" element={<AdminAnalytics />} />
                <Route path="reports" element={<AdminReports />} />
                <Route path="audit-logs" element={<AdminAuditLogs />} />
                <Route path="settings" element={<AdminSettings />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
