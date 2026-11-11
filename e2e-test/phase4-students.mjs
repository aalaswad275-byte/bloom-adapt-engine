/**
 * Phase 4 — 50 test students distributed across the nine classes, with a few
 * deliberately enrolled in a second class. Creation goes through the real
 * instructor roster mutation; duplicate guards are exercised and recorded.
 */
import { load, mut, save, log } from "./lib.mjs";

const FIRST = [
  "Layla", "Omar", "Sara", "Yousef", "Maya", "Ali", "Noor", "Khaled", "Rania",
  "Hassan", "Dina", "Tariq", "Salma", "Ibrahim", "Aya", "Mustafa", "Lina",
  "Kareem", "Huda", "Ziad", "Farah", "Adam", "Jana", "Bilal", "Mariam",
  "Samir", "Rana", "Fadi", "Hiba", "Anas", "Dalia", "Yara", "Nabil", "Reem",
  "Waleed", "Sawsan", "Majd", "Alia", "Rami", "Nour", "Imad", "Lama", "Khalil",
  "Samar", "Yazan", "Dana", "Ammar", "Rasha", "Samer", "Ghada",
];
const LAST = [
  "Haddad", "Nasser", "Khalil", "Mansour", "Aziz", "Saleh", "Farah", "Odeh",
  "Hamdan", "Barakat", "Shami", "Darwish", "Qasem", "Halabi", "Yousef",
  "Jaber", "Sultan", "Rashid", "Amin", "Karam", "Awad", "Fares", "Habib",
  "Zayed", "Sabbagh", "Najjar", "Taha", "Saad", "Rizk", "Malek",
];
const PROFILES = [
  "high", "average", "low", "failing", "improving", "declining",
  "inconsistent", "difficulty_sensitive",
];

const state = load();
state.students = state.students ?? [];
const checks = [];
const classes = state.classes;
const instructorFor = (cls) =>
  state.instructors.find((i) => i.id === cls.instructorId);

// 5 students in the first four classes, 6 in the rest (50 total).
const distribution = classes.map((c, i) => ({ cls: c, count: i < 4 ? 5 : 6 }));
let index = state.students.length;

for (const { cls, count } of distribution) {
  const already = state.students.filter((s) => s.homeClassId === cls.id).length;
  const instructor = instructorFor(cls);
  for (let k = already; k < count; k++) {
    const n = index + 1;
    const name = `${FIRST[index % FIRST.length]} ${LAST[(index * 7) % LAST.length]}`;
    const email = `test.e2e.student.${String(n).padStart(2, "0")}@example.test`;
    const id = await mut(
      "instructorPortal:createMyStudent",
      { classId: cls.id, name: `TEST ${name}`, email, phone: "050-0000000" },
      instructor.token,
    );
    state.students.push({
      id,
      name: `TEST ${name}`,
      email,
      homeClassId: cls.id,
      profile: PROFILES[index % PROFILES.length],
      classes: [cls.id],
    });
    index += 1;
    save(state);
  }
  log(`${cls.name}: roster ${state.students.filter((s) => s.homeClassId === cls.id).length}`);
}

// ---- Multi-class enrollments (8 students join a second, different class) ----
let added = 0;
for (const student of state.students) {
  if (added >= 8) break;
  const second = classes.find((c) => !student.classes.includes(c.id));
  if (!second) continue;
  const instructor = instructorFor(second);
  try {
    await mut(
      "instructorPortal:addStudentToMyClass",
      { classId: second.id, studentId: student.id },
      instructor.token,
    );
    student.classes.push(second.id);
    added += 1;
  } catch (err) {
    checks.push({ check: "second-class enrollment", student: student.email, error: String(err.message) });
  }
}
save(state);

// ---- Duplicate guards -----------------------------------------------------
const firstStudent = state.students[0];
const firstClass = classes.find((c) => c.id === firstStudent.classes[0]);
const firstInstructor = instructorFor(firstClass);

try {
  await mut(
    "instructorPortal:addStudentToMyClass",
    { classId: firstClass.id, studentId: firstStudent.id },
    firstInstructor.token,
  );
  checks.push({ check: "duplicate enrollment", result: "FAIL — duplicate accepted" });
} catch (err) {
  checks.push({ check: "duplicate enrollment", result: "blocked", message: String(err.message) });
}

try {
  await mut(
    "instructorPortal:createMyStudent",
    {
      classId: classes[1].id,
      name: "TEST Duplicate Email",
      email: firstStudent.email,
    },
    instructorFor(classes[1]).token,
  );
  checks.push({ check: "duplicate email", result: "FAIL — duplicate accepted" });
} catch (err) {
  checks.push({ check: "duplicate email", result: "blocked", message: String(err.message) });
}

log(JSON.stringify({ students: state.students.length, secondClasses: added, checks }, null, 2));
