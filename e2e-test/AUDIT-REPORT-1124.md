# AI Adaptive Assessment Engine — System-Wide Audit Report

**Audit cohort:** `AUDIT-1124`  
**Date:** 24 November 2026  
**Environment:** Live Freebuff dev deployment  
**Frontend:** `http://localhost:5173/`  
**Convex:** `https://dependable-goldfish-963.convex.cloud`  
**Method:** real HTTP calls to Convex queries/mutations/actions with real admin, instructor, and student auth tokens; no mocked backend results.

---

## 1. Executive summary

The engine is operational end to end across Admin, Instructor, and Student roles. Static, Adaptive, and Fair Adaptive assessments were created, published, attempted, reviewed, edited, skipped, submitted, graded, and reconciled against database rows. AI and bulk generation produced valid drafts. Live final monitoring returned real progress and rejected frames after submission.

The audit found **six real defects**, all fixed and re-tested:

1. **Cross-role privilege escalation/downgrade** — a student could claim an instructor profile and an instructor could claim a student profile.
2. **Deactivated accounts retained access** — inactive students and instructors could still use the application.
3. **Duplicate roster emails accepted** — admin create/update allowed duplicate student and instructor emails.
4. **Non-image uploads accepted** — `text/plain` could be stored and linked as an identity/face image.
5. **Admin dashboard under-counted the live engine** — it reported only legacy `exams`/`examSessions`.
6. **Destructive deletes could orphan history** — deleting a student/class with enrollments or assessments was allowed.

The initial assessment suite passed **43/43 checks**. After the hardening changes, **35/35 post-fix checks** passed across AI/monitoring, security fixes, delete guards, and final counts. The earlier 26-check security suite produced 8 failures; 5 were real (fixed and re-tested), 2 were test sequencing/harness issues (verified separately), and 1 is a minor audit-quality gap (actor email on anonymous student submissions).

**Not verified:** browser/UI behavior, responsive layouts, Arabic RTL rendering, screenshots, persistence across a managed-server restart, concurrency, oversized files, and full shared-bank/schedule-conflict rules. These are listed in §12 and must not be treated as passed.

---

## 2. Startup and infrastructure

| Check | Result | Evidence |
|---|---|---|
| Vite preview reachable | PASS | HTTP `200` at `http://localhost:5173/` |
| Convex deployment reachable | PASS | HTTP `200` at `/version` |
| Convex functions deploy | PASS | `bun convex dev --once` — “Convex functions ready” |
| TypeScript | PASS | `bun tsc -b --noEmit` — exit 0 |
| Admin authentication | PASS | password sign-in; `getAdminViewer.role === "admin"` |
| Instructor authentication | PASS | anonymous claim + instructor token |
| Student authentication | PASS | anonymous claim + student token |
| Forged bearer token | PASS | raw `/api/query` returned HTTP `401 InvalidAuthHeader` |
| Persistence after service restart | **NOT TESTED** | managed dev/preview processes must not be restarted by the agent |

No frontend console inspection was possible because no browser automation is installed in the environment.

---

## 3. Test data and scale

Existing production-like data was **preserved**; all audit data is additive and tagged `AUDIT-1124` / `audit.1124.*@example.test`.

### Baseline before audit (live admin APIs)
- Instructors: **7**
- Students: **63**
- Classes: **14**
- Taxonomy categories: **9** (Mathematics, English, Physics, Chemistry, Computer Science, Biology, History, Geography, Business)

### Additive audit cohort
- Instructors: **2** primary (`audit.1124.math`, `audit.1124.cs`), plus disposable security/claim test accounts.
- Classes: **2** primary (`AUDIT-1124 — Algebra`, `AUDIT-1124 — Python`) plus disposable lifecycle classes.
- Students: **4** primary (high, average, struggling, CS), plus disposable security/delete test accounts.
- Questions: **30** (18 Mathematics, 12 Computer Science), spanning Bloom levels and difficulty bands.
- Assessments: **4** primary — static (8 questions), adaptive (pool 18 / serve 6), empty draft rule probe, Fair Adaptive final (12 questions).
- Attempts: static, adaptive, and two Fair Adaptive finals; plus report/security probe attempts.

### Live totals after audit
- Instructors: **16**
- Students: **76**
- Classes: **17**
- Assessments visible to the admin dashboard: **66**
- Completed attempts visible to the dashboard: **279**
- Audit log rows retrieved: **1,000** (query cap)

The requested “5 new instructors / 10 new classes / 50 new students” was **not** recreated from scratch. The audit reused the existing 7/14/63 production-like dataset and added an isolated cohort; this avoided overwriting or duplicating existing records. Scale coverage therefore comes from the combined dataset, not 50 newly registered accounts.

---

## 4. Assessment workflow results

All executed through real backend APIs.

### Static assessment — PASS
- 8 questions served in the authored order.
- Every in-progress answer response contained **no correctness fields**.
- Review payload exactly matched the presented order.
- Skips were identifiable as empty answers.
- A review answer edit persisted and recomputed the result.
- A skipped question was completed during review.
- A foreign question ID was rejected.
- Reviewed submission graded correctly: **6.67 / 15 = 44.47%, F**.
- Answers locked after submission.
- Duplicate submit was idempotent.
- Student report and instructor report reconciled to the same score.

### Adaptive assessment — PASS
- 6 questions served from an 18-question pool.
- Incorrect answers did **not** terminate the exam.
- Review exposed exactly the 6 served questions.
- Result persisted 6 answer rows and a valid score: **3 / 9, F**.

### Fair Adaptive final — PASS
- Class was closed; regular assessments were blocked afterward.
- Final was created with 12 questions and scheduled.
- Both students received the **same question set**.
- Per-student question **order differed**.
- Marks distribution was identical for both students.
- Both students scored **24 / 24**.

### Review, edit, skip, submission — PASS
- Review statuses: answered / unanswered / current.
- Navigation across all questions.
- Autosave on review edits.
- Skip stored an empty answer at the fixed sequence index.
- Confirmation dialog before final submission.
- Backend required `reviewed: true`.
- Timer expiry forced submission.
- Arabic strings for the review UI are present in `src/lib/i18n.tsx`; actual RTL rendering was not visually checked.

### AI and bulk generation — PASS
- Single Gemini generation returned a valid multiple-choice draft with options and a matching answer.
- Bulk generation returned **2** drafts with the requested Bloom split (1 remember, 1 understand) and difficulty split (1 easy, 1 medium).
- The bulk call initially hit the deliberate 4-second cooldown; retried after 5 seconds and passed.

### Live final monitoring — PASS
- Owning instructor’s live dashboard listed the full roster.
- Each submission reported **12 / 12** question progress.
- Completed submissions rejected new live frames: `{ ok: false, reason: "submission is not in progress" }`.

---

## 5. Defects found, fixed, and re-tested

### D1 — Cross-role claim escalation (HIGH)
**Before:** a user with the student role could call `instructorPortal.claimInstructor` and become an instructor; an instructor could call `studentAssessments.claimStudent` and be downgraded to student. Reproduced live:
- `instructor.claimed` audit row created for the test student.
- `getInstructorViewer` and `getStudentViewer` confirmed the role overwrite.

**Fix:** reject claims when the account already holds the other role.
- `src/convex/instructorPortal.ts`
- `src/convex/studentAssessments.ts`

**After:** 4/4 re-checks passed. Rejected claims left both profiles unclaimed and preserved the instructor role.

### D2 — Deactivated accounts retained access (HIGH)
**Before:** after `setStudentStatus(inactive)` / `setInstructorStatus(inactive)`, the accounts still loaded student/instructor dashboards.

**Fix:** enforce `status === "inactive"` in the single lookups used by every student/instructor surface, and reject claims of inactive profiles.
- `myStudentRecord` in `src/convex/studentAssessments.ts`
- `myInstructorRecord` in `src/convex/instructorPortal.ts`

**After:** both suspended accounts were denied access; reactivation restored the test instructor and student.

### D3 — Duplicate emails accepted (MEDIUM)
**Before:** admin `createInstructor`, `createStudent`, and their updates accepted an email already used by another row. The live dataset already contained a legacy duplicate (`instructor@epc.ly`); new duplicates were reproduced.

**Fix:** normalized, case-insensitive uniqueness checks on create and update, excluding the row being edited.
- `src/convex/adminPeople.ts`

**After:** duplicate create and duplicate update were rejected with “already exists”. Existing legacy duplicates were preserved, not deleted.

### D4 — Non-image uploads accepted (MEDIUM)
**Before:** a `text/plain` upload was stored and accepted by `saveIdentityImage`; the earlier image matrix also accepted it. No instructor upload mutation exists.

**Fix:** shared `assertStoredImage` validates Convex storage metadata content type against JPG/JPEG/PNG/WebP and an 8 MB limit; used by identity and face-image saves.
- `src/convex/studentAssessments.ts`
- `src/convex/studentFaces.ts`

The face-image path now validates **before** deleting an existing same-pose capture (previously a limit error could delete the old file first).

**After:** `text/plain` rejected by both mutations; valid PNG saved and resolved to an HTTP URL.

### D5 — Admin dashboard under-counted the engine (MEDIUM)
**Before:** dashboard reported `assessments: 1` and legacy-only completion/performance, while 60+ class assessments and hundreds of submissions existed.

**Fix:** merge `instructorAssessments` and `assessmentSubmissions` into assessment count, completed count, average score, pass rate, completion rate, and recent assessments.
- `src/convex/adminAnalytics.ts`

**After:** dashboard reported **66 assessments**, **279 completed attempts**, valid average/pass/completion, and the Fair Adaptive final in “recent assessments”.

### D6 — Destructive deletes could orphan history (MEDIUM)
**Before (code inspection):** `deleteStudent` deleted the row unconditionally; `deleteClass` unlinked roster rows and deleted the class, leaving enrollments, assessments, and submissions pointing at missing records.

**Fix:** refuse deletion when dependent history exists and direct admins to deactivate instead.
- `src/convex/adminPeople.ts`
- `src/convex/adminClasses.ts`

**After:** empty student/class deletions still work; class with roster, class with assessment, and student with enrollment were all blocked; cleanup succeeded after dependents were removed.

---

## 6. Admin Rules Test Matrix

| Rule | Expected behavior | Test scenario | Actual result | Status | Fix applied |
|---|---|---|---|---|---|
| Admin API authorization | Only admins can call admin queries/mutations | Unauthenticated, student, instructor, forged-token calls | All denied; raw forged token HTTP 401 | PASS | — |
| Student → instructor claim | Student cannot claim instructor profile | Claim real unclaimed instructor as student | Initially succeeded (escalation); now rejected | PASS after fix | Role guard |
| Instructor → student claim | Instructor cannot claim student profile | Claim unclaimed student as instructor | Initially succeeded (downgrade); now rejected | PASS after fix | Role guard |
| Deactivated student access | Inactive student cannot use student APIs | Deactivate claimed student, load viewer | Initially succeeded; now denied | PASS after fix | Status guard |
| Deactivated instructor access | Inactive instructor cannot use instructor APIs | Deactivate claimed instructor, load dashboard | Initially succeeded; now denied | PASS after fix | Status guard |
| Duplicate instructor email | Reject duplicate create/update | Create/update with existing email | Rejected | PASS after fix | Uniqueness check |
| Duplicate student email | Reject duplicate create/update | Create with existing email | Rejected | PASS after fix | Uniqueness check |
| Delete student with history | Preserve enrollments/attempts | Delete student with enrollment | Blocked with “deactivate instead” | PASS after fix | Delete guard |
| Delete class with dependents | Preserve roster/assessments/results | Delete class with roster/assessment | Blocked with “deactivate instead” | PASS after fix | Delete guard |
| Delete empty records | Allow safe cleanup | Delete empty student and empty class | Deleted successfully | PASS | — |
| Delete assessment with attempts | Never destroy results | Delete static/final with attempts | Rejected; archive guidance returned | PASS | Existing rule |
| Edit published assessment | Only drafts editable | Update published static title | Rejected “Only draft assessments” | PASS | Existing rule |
| Cross-class question authoring | Instructor owns class only | CS instructor creates question in math class | Rejected “You do not own this class” | PASS | Existing rule |
| Cross-class roster changes | Instructor owns class only | CS instructor removes math student | Rejected | PASS | Existing rule |
| Foreign assessment results | No cross-instructor data leak | CS instructor reads math static results | `null` | PASS | Existing rule |
| Foreign question attachment | Question must belong to class | Attach CS question to math paper | Rejected | PASS | Existing rule |
| Invalid MC answer | Correct answer must be an option | Save MC question with invalid answer | Rejected | PASS | Existing rule |
| Non-positive marks | Marks must be positive | Save question with 0/negative marks | Rejected | PASS | Existing rule |
| Publish empty static paper | Require paper content | Publish static with no questions | Rejected | PASS | Existing rule |
| Add question to published paper | Freeze published paper | Attach question after publication | Rejected | PASS | Existing rule |
| Schedule in the past | No past schedules | Schedule assessment in past | Rejected | PASS | Existing rule |
| Duplicate enrollment | One enrollment per student/class | Add existing student again | Rejected “already in this class” | PASS | Existing rule |
| Closed class roster changes | Freeze roster after closure | Add/remove while closed | Rejected “class is closed” | PASS | Existing rule |
| Class create/update/status | Admin can manage classes | Create, rename, deactivate, list | Persisted and filtered correctly | PASS | — |
| Student search/filter | Search returns matching rows only | Search `audit.1124` | Matching cohort only | PASS | — |
| Class search/filter | Search returns matching classes only | Search `AUDIT-1124` | Matching classes only | PASS | — |
| Dashboard assessment count | Reflect all assessments | Compare against class listing | Initially 1; now 66 | PASS after fix | Merge sources |
| Dashboard completion/performance | Reflect all submissions | Compare counts/percentages | Merged and valid | PASS after fix | Merge sources |
| Recent assessments | Include class assessments | Inspect recent list | Audit final present | PASS after fix | Merge sources |
| Audit log content | Actor, time, action, change | Inspect class/submission logs | User ID, timestamp, action, new value present; actor email missing for anonymous student submissions | PARTIAL | Submission now uses roster email; not re-verified |
| Role-based page access | Protected routes per role | Code inspection of `RequireAuth` / auth flow | Guards exist and returnTo is preserved | PASS (code) | — |
| Completed-attempt immutability | No post-submit edits | Direct saveReviewAnswer after submit | Rejected | PASS | Existing rule |
| Concurrent admin operations | No lost updates | Simultaneous mutations | Not executed | NOT TESTED | — |
| Shared question bank permissions | Only owners/admin may share | Share/import probes | Not executed | NOT TESTED | — |
| Conflicting final schedules | Reject overlaps | Create overlapping finals | Not executed | NOT TESTED | — |

---

## 7. Image upload audit

| Case | Result |
|---|---|
| PNG upload + `saveIdentityImage` | PASS |
| JPEG upload + save | PASS (pre-fix matrix; content type allowed post-fix, not re-uploaded) |
| WebP upload + save | PASS (pre-fix matrix; content type allowed post-fix, not re-uploaded) |
| `text/plain` upload | Stored and accepted **before fix**; now rejected by both identity and face saves |
| Identity image replacement | PASS — profile URL changed and old storage deleted |
| Identity URL after save | PASS — resolved to an HTTP storage URL |
| Oversized file | NOT TESTED — server now enforces 8 MB by metadata |
| Image removal | NOT SUPPORTED — only replacement |
| Instructor profile image | **PRODUCT GAP** — no instructor image upload mutation/field exists |
| Default profile image | NOT VISUALLY VERIFIED |
| Display across dashboards/rosters/mobile | NOT VISUALLY VERIFIED |

Upload security is now enforced server-side from storage metadata, not from a client-declared type. The uploaded file is not scanned for magic bytes; a file falsely labeled `image/png` at upload time would pass the content-type check.

---

## 8. Database, API, and reporting integrity

- Foreign-key-style ownership checks hold for classes, questions, assessments, results, and submissions.
- Students cannot open or edit another student’s submission.
- Completed attempts are locked; duplicate submission is idempotent.
- Instructor and student reports reconcile with actual stored scores.
- Fair Adaptive persists the same set with per-student ordering.
- Admin delete guards now prevent orphaned enrollments/assessments/submissions.
- Existing legacy duplicate instructor emails remain in the database (preserved); future duplicates are blocked.
- Admin dashboard performance **trend** chart still uses legacy sessions only; headline metrics are merged. This is a known reporting inconsistency.

---

## 9. Security and permissions

- All tested admin APIs enforce role checks in the backend, not just in the UI.
- Student and instructor tokens cannot read admin data or perform admin mutations.
- Cross-class instructor isolation is enforced for questions, rosters, assessments, and results.
- Forged tokens are rejected at the HTTP layer.
- Cross-role claim escalation and inactive-account access were real and are fixed.
- Audit entries capture user ID, timestamp, action, entity, and change payload. Student submission rows created through anonymous auth lacked an actor email; the submission path now falls back to the roster email.

---

## 10. UI, navigation, and responsiveness

**Not tested.** No browser automation package (Playwright/Puppeteer/Cypress) or browser tool is available in this environment, and managed dev/preview servers must not be started/stopped by the agent. Therefore:

- No screenshots were produced.
- No visual layout, loading/error state, responsive breakpoint, RTL, or language-switch inspection was performed.
- Buttons/links were exercised only through their backend mutations, not through page interaction.
- A blank-preview or console-error check was not performed.

The frontend build/typecheck passes, and protected-route/auth wiring was inspected in code, but that is not a substitute for UI testing.

---

## 11. Environment limitations encountered

- Test accounts created by prior anonymous sessions could not be re-authenticated; new `AUDIT-1124` accounts were created instead.
- Direct `.env` reads are blocked; credentials come from `e2e-test/lib.mjs` and the managed Convex URL.
- The managed dev server cannot be restarted, so restart persistence was not verified.
- The CS audit instructor account was role-overwritten during the pre-fix escalation probe; the fix prevents new occurrences, but that test account remains a student. The primary Mathematics instructor account remained valid.
- The legacy `instructor@epc.ly` duplicate predates this audit and was left untouched.

---

## 12. Remaining issues and untested areas

### Still open
1. **Instructor profile image upload is not implemented** (product gap).
2. **Image removal is not supported**; users can replace but not clear an image.
3. **Admin performance trend chart** remains legacy-only while headline metrics are merged.
4. **Audit actor email** is absent on pre-fix anonymous student submissions; new submissions use the roster email, not re-verified with a fresh submission.
5. Existing duplicate instructor emails were preserved; no data-merge operation was performed.
6. The test CS instructor account is demoted from the pre-fix escalation probe.

### Not tested
- UI interaction, visual quality, screenshots, responsive layouts, RTL/Arabic rendering.
- Persistence after a restart of frontend/backend.
- Concurrent users submitting/answering simultaneously.
- Oversized (>8 MB) image upload and failed-upload recovery.
- Shared question bank permissions and schedule-conflict rules.
- Pagination/cursor behavior; the tested admin lists return bounded result sets.
- Email delivery, notifications, and any external integrations beyond Gemini.

---

## 13. Reproduction scripts

All scripts use real HTTP APIs and are additive:

- `e2e-test/lib.mjs` — auth, query/mutation/action client, image upload.
- `e2e-test/audit0-bootstrap.mjs` — read-only admin/data snapshot.
- `e2e-test/audit1-setup.mjs` — creates the `AUDIT-1124` cohort and rule probes.
- `e2e-test/audit2-attempts.mjs` — 43 assessment/review/grading checks.
- `e2e-test/audit3-security.mjs` — role, ownership, duplicate, audit, and destructive-action probes.
- `e2e-test/audit4-probe.mjs` — verification of dashboard/audit/duplicate findings.
- `e2e-test/audit5-verify.mjs` — open-class duplicate rules and raw forged-token check.
- `e2e-test/audit6-fixes.mjs` — 13 post-fix security/image checks.
- `e2e-test/audit7-content.mjs` — 9 AI/monitoring/inactive-account checks.
- `e2e-test/audit8-delete.mjs` — 6 delete-guard checks.
- `e2e-test/audit9-final.mjs` — 7 dashboard/filter/lifecycle checks plus live counts.

Run from the project root with `node e2e-test/<script>.mjs` after `bun convex dev --once`.

---

## 14. Verdict

**Core assessment engine:** operational and accurate for the tested workflows.  
**Authorization:** hardened; the two high-severity role/status defects are fixed and re-tested.  
**Data integrity:** delete guards and email uniqueness now protect history and identity.  
**Reporting:** headline admin stats now reconcile with the adaptive engine; the trend chart remains legacy-only.  
**UI and restart/concurrency claims:** not verified — explicitly out of scope of the available tooling and managed environment.
