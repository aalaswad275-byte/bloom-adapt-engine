# End-to-End Testing Report — AI Adaptive Assessment Engine

**Date:** 11 November 2026
**Environment:** Freebuff deployment `https://dependable-goldfish-963.convex.cloud` (live Convex + React app)
**Data policy:** every record created for this test is prefixed `TEST` / `test.e2e.*@example.test`. No existing user, class, assessment, question or result was edited or deleted. Test accounts were created through real sign-in, claim, class, question and exam workflows — no mock rows and no directly inserted grades.

---

## 1. Scope and method

The test exercised the full product path:

1. taxonomy subjects/categories and classes;
2. instructor account creation and class ownership;
3. student registration, identity onboarding and enrollment;
4. question banks with subject, topic, type, Bloom level, difficulty, answer, explanation and marks;
5. static, random, adaptive and Fair Adaptive final assessments;
6. real exam sessions (`startAssessment` → `getTakeAssessment` → `answerAndNext` → `submitAssessment`);
7. class/subject isolation and role permissions;
8. class, assessment and student analytics;
9. independent regrading of every stored submission from its stored answers and question key;
10. database relationship checks.

Attempts were answered by a deterministic-but-varied student simulator that chooses correct/incorrect answers from a performance profile and submits through the public student APIs. Scores, percentages, grades and pass flags are therefore computed by the application.

**Scale:** 5 subject categories, 9 classes, 5 instructors, 50 students, 58 enrollments, 186 questions, 37 assessments, 126 completed attempts, 1,085 graded answers.

---

## 2. Test subjects and classes

| Subject | Classes | Instructors |
|---|---|---|
| Mathematics | Algebra, Calculus | 1 |
| English | English Grammar | 1 |
| Physics | Physics: Mechanics | 1 |
| Chemistry | Organic Chemistry | 1 |
| Computer Science | Algorithms, Programming: C++, Programming: Java, Programming: Python | 1 |

- **Subjects/categories created:** 5 (plus 9 topics: Algebra, Calculus, Grammar, Mechanics, Organic Chemistry, Algorithms, C++, Java, Python).
- **Classes created:** 9.
- **Enrollments:** 58 across the 9 classes, including 8 students enrolled in a second class. Class rosters range from 5 to 10 because of cross-enrollment.
- **Academic years:** the class schema in this build has no academic-year field, so distinct years could not be recorded. This is listed as a product gap in §12. Classes are labelled by subject/level instead.

---

## 3. Instructors and authorization

Five instructor accounts were created and assigned as follows:

| Instructor | Classes |
|---|---|
| Mathematics | Algebra, Calculus |
| English | English Grammar |
| Physics | Physics: Mechanics |
| Chemistry | Organic Chemistry |
| Computer Science | Algorithms, C++, Java, Python |

Each instructor created their own classes, questions and assessments. Verification:

- every cross-class `listAssessments` call from the other four instructors was rejected (40/40 probes blocked);
- `getAssessment` on a foreign assessment returned `null`, not data;
- attaching a foreign class's question to a draft was rejected with a class-mismatch error;
- instructor dashboards listed only owned classes;
- shared-bank queries per class returned only the class's own category: **0 foreign-category rows** in all 9 classes;
- instructor accounts could not call admin-only endpoints (`Unauthorized: admin role required`).

An existing production instructor (`instructor@epc.ly`) also signed in successfully and saw only its 4 classes.

---

## 4. Students and enrollment

- **Students registered:** 50, all onboarded through the real anonymous-session → claim → identity-image → 7 face poses → class-join flow.
- **Profiles:** high, average, low, consistently failing, improving, declining, inconsistent and difficulty-sensitive.
- **Multi-class:** 8 students joined a second class. No student appears twice in the same class.
- **Duplicate guards:** duplicate enrollment was blocked — “TEST Layla Haddad is already in this class.”; duplicate email was blocked — “A student with this email already exists (TEST Layla Haddad). Search for them to add them to this class.”
- **Isolation:** a student reading another student's submission received “Submission not found”.

---

## 5. Question banks

| Subject | Questions |
|---|---|
| Mathematics | 60 (Algebra 42, Calculus 18) |
| English | 18 |
| Physics | 18 |
| Chemistry | 18 |
| Computer Science | 72 (4 classes × 18) |
| **Total** | **186** |

Each class's core bank has 18 questions, three per Bloom level, with subject, category, topic, type (multiple choice, true/false, short answer), Bloom level, difficulty (Easy/Medium/Hard/Expert), correct answer, explanation and marks (1–3). Algebra additionally has a 24-question mixed-difficulty branching pool.

- **Shared questions:** 2 per class (18 total) published through the real `setBankQuestionShare` workflow.
- **Shared-bank scoping:** verified per class; each class saw only its own category and its own shared rows (English also sees pre-existing English shared rows, correctly scoped).
- **Uniqueness fix:** duplicate generated stems were found during testing and corrected (see §11); a final scan reports **0 duplicate question texts** within any class.

---

## 6. Assessments and attempts

| Type | Created | Completed attempts |
|---|---|---|
| Static (manual order) | 9 | 58 |
| Random (per-student draw) | 9 | 9 |
| Adaptive (Bloom ladder) | 10 (incl. 1 branching probe) | 41 |
| Fair Adaptive final (shared set, shuffled order) | 9 | 18 |
| **Total** | **37** | **126** |

All 37 assessments are published. No published static, adaptive or final paper has an empty attached question set; random papers draw their per-student set from the class bank, as designed.

### Fair Adaptive final integrity

- Every final submission in a class used **the same question set**.
- Question order was **individually shuffled**: each final had as many distinct orders as submissions (2 per class).
- Total marks and grading rules were identical for all students in a class.
- Static papers had **one identical order** for every student.
- Adaptive papers branch by performance (see §7).

### Attempts per class

| Class | Attempts |
|---|---|
| Algebra | 20 |
| Calculus | 17 |
| English Grammar | 12 |
| Physics: Mechanics | 12 |
| Organic Chemistry | 13 |
| Algorithms (CS) | 13 |
| Programming: C++ | 13 |
| Programming: Java | 13 |
| Programming: Python | 13 |

---

## 7. Results and analytics

### Pass / fail

- **Attempt level:** 90 passed, 36 failed (71.4% pass rate).
- **Student level:** 30 students passed every attempt they took; 7 failed every attempt; 13 had a mixed record; 43 passed at least one assessment.
- **Grade mix:** A 29, B 21, C 14, D 14, E 11, F 37. The E band is the fix described in §11; the single pre-fix 50% submission remains an F with `passed = true` in historical data.

### Static vs adaptive vs final

| Mode | Attempts | Average | Pass rate |
|---|---|---|---|
| Static | 58 | 64.7% | 74.1% |
| Random | 9 | 69.9% | 77.8% |
| Adaptive | 41 | 63.9% | 65.9% |
| Fair Adaptive final | 18 | 68.2% | 72.2% |

Across the 33 students who attempted both a static and an adaptive paper: 11 improved by ≥10 points, 12 declined by ≥10 points, average delta −0.1 points. Examples: Farah Awad 64% static → 83% adaptive (+19.4); Layla Haddad 84% → 100% (+15.5); Dana Jaber 100% → 42% (−58.3). This matches the deliberately declining/low profiles rather than a uniform “adaptive inflates marks” pattern.

### Adaptive branching

The core bank has exactly 3 questions per Bloom level, so with a 9-item display quota every student necessarily receives all of them; sequences were identical. A 42-question mixed-difficulty adaptive probe was added to Algebra. Five real attempts produced **5 distinct sequences**:

- high performer: Remember → Understand → Apply, 12/12 (A);
- average: 5/9 (E); low: 6/11 (E); failing: 2/9 (F), staying in Remember for all 9 items; improving: 8/11 (C).

This confirms the ladder and item selection do respond to performance when the pool is deep enough.

### Fair final results by class

| Class | Attempts | Average | Passed |
|---|---|---|---|
| Algebra | 2 | 75.0% | 2 |
| Calculus | 2 | 88.9% | 2 |
| English Grammar | 2 | 22.2% | 0 |
| Physics: Mechanics | 2 | 80.6% | 2 |
| Organic Chemistry | 2 | 72.2% | 2 |
| Algorithms (CS) | 2 | 38.9% | 0 |
| Programming: C++ | 2 | 63.9% | 1 |
| Programming: Java | 2 | 77.8% | 2 |
| Programming: Python | 2 | 94.4% | 2 |

### Bloom and difficulty analytics

| Bloom | Answers | Accuracy |
|---|---|---|
| Remember | 321 | 66.7% |
| Understand | 317 | 67.5% |
| Apply | 303 | 65.0% |
| Analyze | 72 | 63.9% |
| Evaluate | 54 | 72.2% |
| Create | 18 | 50.0% |

| Difficulty | Answers | Accuracy |
|---|---|---|
| Easy | 614 | 67.3% |
| Medium | 382 | 64.4% |
| Hard | 67 | 71.6% |
| Expert | 22 | 54.5% |

Class reports, per-assessment results, student trends and Bloom breakdowns all reconciled with the stored submissions. Summing report pass/fail counts reproduces the database totals exactly (90/36). Reports use real attempts; no fabricated summary values were found.

---

## 8. Database and functional integrity

Final integrity scan over all 37 test assessments / 126 submissions:

| Check | Result |
|---|---|
| Duplicate student emails | 0 |
| Duplicate class enrollments | 0 |
| Orphaned assessment→question links | 0 |
| Submissions with missing student / assessment / class mismatch / non-enrolled student | 0 |
| Published static/adaptive/final papers with no attached questions | 0 |
| Answer-array length vs presented sequence | 0 mismatches |
| **Stored score vs independent regrade from stored answers + key** | **0 mismatches out of 126** |
| Pass flag vs 50% threshold | 0 mismatches |
| Grade vs grade scale | 1 historical mismatch (pre-fix 50% F, §11) |
| Duplicate question texts within a class | 0 |
| Cross-class data leakage | none observed |

The 126 attempts include static, random, adaptive and final papers; the independent regrade recomputed every mark total and matched the stored `score`, `maxScore`, `percent`, `grade` and `passed` for all new submissions.

**Production data preserved:** the pre-existing English class still has 20 assessments, 33 questions, 83 submissions (82 completed); production roles remain 1 admin, 2 instructors and 1 student. Test data is additive only.

---

## 9. Bugs found and fixes

### B1 — 50% scored `F` while `passed = true` (fixed)

**Symptom:** an inconsistent-profile student scored 5/10 (50%) and received `passed: true` with grade `F`.
**Cause:** `DEFAULT_PASS_THRESHOLD` is 50, but `DEFAULT_GRADING_SCALE` had bands A≥90, B≥80, C≥70, D≥60, F≥0 — no band for the passing 50–59 range. The rest of the app (`adminLib.gradeFor`) already used an E band at 50.
**Fix:** added `{ minPercent: 50, letter: "E" }` to `DEFAULT_GRADING_SCALE` in `src/lib/adaptiveLadder.ts`. The pass mark remains 50% because the UI and reports consistently state 50%.
**Verification:** unit probe over 0/25/49/50/55/59/60/70/80/90/100 now yields F/F/F/E/E/E/D/C/B/A/A; 11 new E grades were issued and every one is consistent with `passed`. The one pre-fix submission still shows F/pass because historical results were deliberately not rewritten; it is the only grade inconsistency in the database.

### B2 — generated question stems repeated within a class (test-harness data issue, fixed)

**Symptom:** template parameters repeated across Bloom levels, producing identical stems and colliding answer-key lookups.
**Fix:** all 162 core questions received a unique `[Qn]` suffix (and the branching probe uses `[Dn]`); final scan shows 0 duplicates.
**Note:** this was a defect in the test-data generator, not in the application's question authoring.

### B3 — logout does not revoke an already-issued access token (open, framework behaviour)

`auth:signOut` succeeds (`null`), the client discards its token, and refresh tokens are invalidated — but a copied access JWT continued to authorise admin calls after sign-out. This is Convex Auth's stateless-JWT model: the access token remains valid until it expires. It is not a regression in this codebase, but it is a real exposure window if a token is stolen. Recommendation: shorten the access-token lifetime and/or validate the session record in the authorization guard if immediate revocation is required. Not changed during testing because it alters the auth architecture.

### B4 — class academic year is not modelled (open, product gap)

The class document has no academic-year field, so the “different academic years” scenario could not be stored. Recommendation: add an optional academic-year/term field to the class schema and instructor class creation.

### B5 — adaptive branching not observable on shallow banks (resolved by evidence, not a code bug)

With 3 questions per Bloom and a 9-item display quota, every student must receive every question, so sequences are identical by construction. A deeper mixed-difficulty pool produced 5 distinct sequences for 5 students. Recommendation: ensure adaptive pools have more than `displayCount / 6` questions per Bloom and mixed difficulty, or surface a warning in the authoring UI.

---

## 10. Remaining limitations

- No browser automation tool was available: layouts and interactions were not visually inspected; all verification is API/database level.
- Only two attempts per class were run for the Fair final and one to four for adaptive; class-level trends are therefore illustrative, not statistically robust.
- Student sessions are anonymous and expire; test students have no password login.
- The class report groups the Fair final under the static family (final papers are fixed-set); final results are reported separately per assessment in this report.
- Historical 50% submission retains the pre-fix F grade, by design.
- 18 shared questions is a small sample; subject scoping was verified structurally (0 foreign-category rows), not with a large shared catalogue.

---

## 11. Reproducing the test

Scripts remain in `e2e-test/` (state is stored in `/tmp/e2e/state.json`):

| Script | Purpose |
|---|---|
| `lib.mjs` | HTTP client, auth, image upload, shared helpers |
| `phase1-setup.mjs` | categories, 5 instructors, 9 classes |
| `phase2-questions.mjs` | 18 questions/class + shared publishing |
| `phase2b-unique-texts.mjs` | unique question stems |
| `phase3-assessments.mjs` | static/random/adaptive/final creation + publish |
| `phase4-students.mjs` | 50 students, multi-class, duplicate guards |
| `phase5-accounts.mjs` | anonymous claim + identity onboarding |
| `phase6-attempts.mjs <classIndex>` | real exam attempts per class |
| `phase7-verify.mjs` | isolation, permissions, reports |
| `phase8-permissions.mjs` | shared-bank scoping, duplicate guards, logout |
| `phase9-branching.mjs` | deep-pool adaptive branching probe |

Code change: `src/lib/adaptiveLadder.ts` only. `bunx convex dev --once` and `bunx tsc -b --noEmit` both exit 0.

---

## 12. Conclusion

The engine works end to end across five subjects, nine classes and five instructors. Authentication/registration, class ownership, question authoring, shared-bank subject scoping, all four assessment modes, real exam execution, grading, pass/fail, reports and analytics reconcile with the database. All 126 submissions independently regrade to their stored results, with no orphan links, duplicate enrollments, duplicate emails, cross-class leakage or empty published assessments. One product defect (passing 50% graded F) was found and fixed with an E band, and one test-data defect (duplicate stems) was corrected. Remaining items are the stateless-token logout window, the missing academic-year field and the recommendation to deepen adaptive pools.
