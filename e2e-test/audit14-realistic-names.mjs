/**
 * Realistic Libyan naming pass.
 * Only records whose visible name starts with TEST/AUDIT-1124 (or whose email
 * uses the test.e2e/audit.1124 domain) are modified. Production-like rows are
 * left untouched. Every modified row gets testData: true.
 */
import { load, q, mut, log } from "./lib.mjs";

const state = load();
const admin = state.auditAdminToken;
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  log(`${pass ? "✓" : "✗"} ${name}`, pass ? "" : JSON.stringify(detail).slice(0, 500));
}

const maleFirst = [
  ["محمد", "Mohamed"], ["أحمد", "Ahmed"], ["عبد الرحمن", "Abdulrahman"],
  ["محمود", "Mahmoud"], ["علي", "Ali"], ["سالم", "Salem"], ["خالد", "Khaled"],
  ["مصطفى", "Mustafa"], ["يوسف", "Yousef"], ["عمر", "Omar"], ["أنس", "Anas"],
  ["طارق", "Tarek"], ["هيثم", "Haitham"], ["معاذ", "Moaz"], ["إبراهيم", "Ibrahim"],
  ["عبد الله", "Abdullah"], ["ياسين", "Yassin"], ["زياد", "Ziad"], ["أمجد", "Amjad"],
  ["فرج", "Faraj"], ["ناصر", "Nasser"], ["بشير", "Bashir"], ["عادل", "Adel"],
  ["مروان", "Marwan"], ["سفيان", "Sufyan"], ["وليد", "Walid"], ["رائد", "Raed"],
  ["عماد", "Imad"], ["صهيب", "Suhaib"], ["إلياس", "Elias"], ["أيمن", "Ayman"],
  ["جمال", "Jamal"],
];
const femaleFirst = [
  ["فاطمة", "Fatima"], ["آمنة", "Amina"], ["مريم", "Mariam"], ["سارة", "Sara"],
  ["غادة", "Ghada"], ["رانيا", "Rania"], ["سلمى", "Salma"], ["ليلى", "Layla"],
  ["نور", "Nour"], ["هدى", "Huda"], ["أسماء", "Asmaa"], ["خديجة", "Khadija"],
  ["نجاة", "Najah"], ["سميرة", "Samira"], ["منى", "Mona"], ["دعاء", "Duaa"],
  ["إيمان", "Iman"], ["بشرى", "Bushra"], ["ريم", "Reem"], ["شيماء", "Shaima"],
  ["حسناء", "Hasna"], ["أمل", "Amal"], ["وفاء", "Wafa"], ["سعاد", "Souad"],
  ["نجلاء", "Najla"], ["رجاء", "Raja"], ["حنان", "Hanan"], ["زينب", "Zainab"],
  ["ملاك", "Malak"], ["تهاني", "Tahani"], ["لبنى", "Lubna"], ["أروى", "Arwa"],
];
const fathers = [
  ["علي", "Ali"], ["سالم", "Salem"], ["مصطفى", "Mustafa"], ["خالد", "Khaled"],
  ["محمد", "Mohamed"], ["أحمد", "Ahmed"], ["عبد الله", "Abdullah"], ["عمر", "Omar"],
  ["يوسف", "Yousef"], ["إبراهيم", "Ibrahim"],
];
const families = [
  ["الورفلي", "Al-Werfalli"], ["المقريف", "Al-Maqrif"], ["الزوي", "Al-Zawi"],
  ["الترهوني", "Al-Tarhouni"], ["القماطي", "Al-Qamati"], ["المصراتي", "Al-Misrati"],
  ["الجربي", "Al-Jarbi"], ["الشيباني", "Al-Shaibani"], ["بن عامر", "Bin Amer"],
  ["الفيتوري", "Al-Fitouri"], ["الشريف", "Al-Sharif"], ["العبيدي", "Al-Obeidi"],
  ["البركي", "Al-Barki"], ["الهوني", "Al-Houni"], ["المغيربي", "Al-Mughairbi"],
  ["الفلاح", "Al-Fallah"], ["بن سعيد", "Bin Saeed"], ["الغرياني", "Al-Ghariani"],
  ["الزنتاني", "Al-Zintani"], ["الصادق", "Al-Sadeq"], ["الهدار", "Al-Haddar"],
  ["أبو شعالة", "Abu Shaala"], ["الحاج", "Al-Haj"], ["بن يونس", "Bin Younis"],
  ["القليعي", "Al-Qulaiei"], ["السويحلي", "Al-Suwayhli"], ["الشلوي", "Al-Shalwi"],
  ["أبو زيد", "Abu Zeid"], ["الريفي", "Al-Rifi"], ["العريبي", "Al-Oraibi"],
  ["المبروك", "Al-Mabrouk"], ["القمودي", "Al-Qamoudi"],
];

const usedNames = new Set();
function generatedIdentity(index) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const n = index + attempt;
    const female = n % 2 === 1;
    const first = female ? femaleFirst[n % femaleFirst.length] : maleFirst[n % maleFirst.length];
    const family = families[(n * 7 + 3) % families.length];
    const father = fathers[(n * 3 + 2) % fathers.length];
    const arabic = `${first[0]} ${father[0]} ${family[0]}`;
    const english = `${first[1]} ${father[1]} ${family[1]}`;
    if (usedNames.has(arabic)) continue;
    usedNames.add(arabic);
    return { arabic, english, name: `${arabic} — ${english}` };
  }
  throw new Error("Could not generate a unique name");
}

const specificStudents = [
  {
    match: (s) => s.email === "audit.1124.high@example.test",
    arabic: "محمد علي الورفلي",
    english: "Mohamed Ali Al-Werfalli",
  },
  {
    match: (s) => s.email === "audit.1124.average@example.test",
    arabic: "أحمد سالم المقريف",
    english: "Ahmed Salem Al-Maqrif",
  },
  {
    match: (s) => s.email === "audit.1124.struggling@example.test",
    arabic: "عبد الرحمن مصطفى الزوي",
    english: "Abdulrahman Mustafa Al-Zawi",
  },
  {
    match: (s) => s.email === "audit.1124.cs.student@example.test",
    arabic: "محمود خالد الترهوني",
    english: "Mahmoud Khaled Al-Tarhouni",
  },
  {
    match: (s) => s.email === "audit.1124.escalation.student@example.test",
    arabic: "فاطمة محمد القماطي",
    english: "Fatima Mohamed Al-Qamati",
  },
  {
    match: (s) => s.email?.startsWith("audit.1124.priv.student."),
    arabic: "آمنة علي المصراتي",
    english: "Amina Ali Al-Misrati",
  },
  {
    match: (s) => s.email?.startsWith("audit.1124.priv.student2."),
    arabic: "مريم أحمد الجربي",
    english: "Mariam Ahmed Al-Jarbi",
  },
  {
    match: (s) => s.email?.startsWith("audit.1124.org.student."),
    arabic: "سارة خالد الشيباني",
    english: "Sara Khaled Al-Shaibani",
  },
];

function isArtificial(row) {
  return (
    /^(TEST|AUDIT-1124)\b/.test(row.name) ||
    /^(test\.e2e\.|audit\.1124\.)/i.test(row.email ?? "")
  );
}

const beforeStudents = await q("adminPeople:listStudents", {}, admin);
const beforeInstructors = await q("adminPeople:listInstructors", {}, admin);
const artificialStudents = beforeStudents.filter(isArtificial);
const artificialInstructors = beforeInstructors.filter(isArtificial);
check("Found artificial student records to rename", artificialStudents.length > 0, {
  count: artificialStudents.length,
});
check("Found artificial instructor records to rename", artificialInstructors.length > 0, {
  count: artificialInstructors.length,
});

const beforeById = new Map(artificialStudents.map((s) => [s._id, s]));
const beforeWithClass = artificialStudents.filter((s) => s.classId).length;
const beforeWithOrg = artificialStudents.filter(
  (s) => s.institutionId || s.teachingCenterId || s.governmentFacilityId,
).length;

const usedEmails = new Set(
  beforeStudents
    .filter((s) => !isArtificial(s))
    .map((s) => (s.email ?? "").toLowerCase())
    .filter(Boolean),
);
function emailFor(english) {
  const base = english
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim()
    .replace(/\s+/g, ".");
  let candidate = `${base}@example.test`;
  let n = 2;
  while (usedEmails.has(candidate)) {
    candidate = `${base}${n}@example.test`;
    n += 1;
  }
  usedEmails.add(candidate);
  return candidate;
}

let nextStudentId = 1001;
const existingIds = new Set(
  beforeStudents.map((s) => s.studentIdNumber).filter(Boolean),
);
function studentIdNumber() {
  while (existingIds.has(`2026-${nextStudentId}`)) nextStudentId += 1;
  const id = `2026-${nextStudentId}`;
  existingIds.add(id);
  nextStudentId += 1;
  return id;
}

const studentResults = [];
let generatedIndex = 0;
for (const student of artificialStudents) {
  const specific = specificStudents.find(
    (s) => s.match(student) && !usedNames.has(s.arabic),
  );
  let identity;
  if (specific) {
    usedNames.add(specific.arabic);
    identity = { ...specific, name: `${specific.arabic} — ${specific.english}` };
  } else {
    identity = generatedIdentity(generatedIndex);
    generatedIndex += 1;
  }
  const email = emailFor(identity.english);
  await mut(
    "adminPeople:updateStudent",
    {
      id: student._id,
      fields: {
        name: identity.name,
        email,
        studentIdNumber: studentIdNumber(),
        testData: true,
      },
    },
    admin,
  );
  studentResults.push({
    id: student._id,
    oldName: student.name,
    name: identity.name,
    email,
  });
}
check(
  "All artificial students renamed",
  studentResults.length === artificialStudents.length,
  { renamed: studentResults.length, expected: artificialStudents.length },
);

const usedInstructorEmails = new Set(
  beforeInstructors
    .filter((i) => !isArtificial(i))
    .map((i) => (i.email ?? "").toLowerCase())
    .filter(Boolean),
);
function instructorEmailFor(english) {
  const base = english
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim()
    .replace(/\s+/g, ".");
  let candidate = `${base}@example.test`;
  let n = 2;
  while (usedInstructorEmails.has(candidate)) {
    candidate = `${base}${n}@example.test`;
    n += 1;
  }
  usedInstructorEmails.add(candidate);
  return candidate;
}

const specificInstructors = [
  {
    match: (i) => i.email === "audit.1124.math@example.test" && !i.name.includes("Duplicate"),
    arabic: "خالد عبد الله بن عامر",
    english: "Khaled Abdullah Bin Amer",
  },
  {
    match: (i) => i.email === "audit.1124.cs@example.test",
    arabic: "نادية مصطفى الفيتوري",
    english: "Nadia Mustafa Al-Fitouri",
  },
  {
    match: (i) => i.email?.startsWith("audit.1124.org.instructor."),
    arabic: "عبد السلام محمد الشريف",
    english: "Abdulsalam Mohamed Al-Sharif",
  },
];
const usedInstructorNames = new Set();
const instructorResults = [];
let instructorIndex = 0;
for (const instructor of artificialInstructors) {
  const specific = specificInstructors.find((s) => s.match(instructor));
  let identity;
  if (specific && !usedInstructorNames.has(specific.arabic)) {
    usedInstructorNames.add(specific.arabic);
    identity = { ...specific, name: `${specific.arabic} — ${specific.english}` };
  } else {
    let candidate;
    do {
      const female = instructorIndex % 3 === 1;
      const first = female
        ? femaleFirst[(instructorIndex * 5 + 7) % femaleFirst.length]
        : maleFirst[(instructorIndex * 3 + 5) % maleFirst.length];
      const family = families[(instructorIndex * 11 + 4) % families.length];
      const father = fathers[(instructorIndex * 5 + 1) % fathers.length];
      candidate = {
        arabic: `${first[0]} ${father[0]} ${family[0]}`,
        english: `${first[1]} ${father[1]} ${family[1]}`,
      };
      instructorIndex += 1;
    } while (
      usedInstructorNames.has(candidate.arabic) ||
      usedNames.has(candidate.arabic)
    );
    usedInstructorNames.add(candidate.arabic);
    identity = { ...candidate, name: `${candidate.arabic} — ${candidate.english}` };
  }
  const email = instructorEmailFor(identity.english);
  await mut(
    "adminPeople:updateInstructor",
    {
      id: instructor._id,
      fields: { name: identity.name, email, testData: true },
    },
    admin,
  );
  instructorResults.push({
    id: instructor._id,
    oldName: instructor.name,
    name: identity.name,
    email,
  });
}

const adminName = "عبد الحكيم محمد الفيتوري — Abdulhakim Mohamed Al-Fitouri";
await mut("adminAnalytics:updateAdminProfile", { name: adminName }, admin);

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------
const afterStudents = await q("adminPeople:listStudents", {}, admin);
const afterInstructors = await q("adminPeople:listInstructors", {}, admin);
const adminViewer = await q("adminAnalytics:getAdminViewer", {}, admin);
const renamedStudents = afterStudents.filter((s) => studentResults.some((r) => r.id === s._id));
const renamedInstructors = afterInstructors.filter((i) =>
  instructorResults.some((r) => r.id === i._id),
);
check(
  "No artificial student labels remain in the student list",
  !afterStudents.some((s) => /^(TEST|AUDIT-1124)\b/.test(s.name)),
  afterStudents.filter((s) => /^(TEST|AUDIT-1124)\b/.test(s.name)).map((s) => s.name),
);
check(
  "No artificial instructor labels remain in the instructor list",
  !afterInstructors.some((i) => /^(TEST|AUDIT-1124)\b/.test(i.name)),
  afterInstructors.filter((i) => /^(TEST|AUDIT-1124)\b/.test(i.name)).map((i) => i.name),
);
check(
  "Every renamed student is internally marked testData",
  renamedStudents.length === studentResults.length && renamedStudents.every((s) => s.testData === true),
  {
    renamed: renamedStudents.length,
    missing: renamedStudents.filter((s) => s.testData !== true).map((s) => s.name),
  },
);
check(
  "Every renamed instructor is internally marked testData",
  renamedInstructors.length === instructorResults.length &&
    renamedInstructors.every((i) => i.testData === true),
  {
    renamed: renamedInstructors.length,
    missing: renamedInstructors.filter((i) => i.testData !== true).map((i) => i.name),
  },
);
check(
  "Student names are unique after the rename",
  new Set(renamedStudents.map((s) => s.name)).size === renamedStudents.length,
  { count: renamedStudents.length },
);
check(
  "Instructor names are unique after the rename",
  new Set(renamedInstructors.map((i) => i.name)).size === renamedInstructors.length,
  { count: renamedInstructors.length },
);
check(
  "Student emails are unique after the rename",
  new Set(afterStudents.map((s) => (s.email ?? "").toLowerCase()).filter(Boolean)).size ===
    afterStudents.filter((s) => s.email).length,
  afterStudents
    .map((s) => (s.email ?? "").toLowerCase())
    .filter((email, _i, all) => email && all.indexOf(email) !== all.lastIndexOf(email)),
);
check(
  "Student IDs are unique and assigned",
  renamedStudents.every((s) => typeof s.studentIdNumber === "string" && s.studentIdNumber.length > 0) &&
    new Set(afterStudents.map((s) => s.studentIdNumber).filter(Boolean)).size ===
      afterStudents.filter((s) => s.studentIdNumber).length,
  renamedStudents.filter((s) => !s.studentIdNumber).map((s) => s.name),
);
check(
  "Class enrollments were preserved during the rename",
  renamedStudents.filter((s) => s.classId).length === beforeWithClass,
  {
    before: beforeWithClass,
    after: renamedStudents.filter((s) => s.classId).length,
  },
);
check(
  "Organization assignments were preserved during the rename",
  renamedStudents.filter(
    (s) => s.institutionId || s.teachingCenterId || s.governmentFacilityId,
  ).length === beforeWithOrg,
  {
    before: beforeWithOrg,
    after: renamedStudents.filter(
      (s) => s.institutionId || s.teachingCenterId || s.governmentFacilityId,
    ).length,
  },
);
check(
  "Administrator now has a realistic Libyan display name",
  adminViewer.name === adminName,
  { name: adminViewer.name },
);
const imageCount = renamedStudents.filter((s) => s.identityImageId).length;
log(
  JSON.stringify(
    {
      renamed: {
        students: studentResults.length,
        instructors: instructorResults.length,
        admin: adminName,
      },
      avatars: {
        withUploadedImage: imageCount,
        usingDefaultAvatar: renamedStudents.length - imageCount,
      },
      sampleStudents: studentResults.slice(0, 8),
      summary: {
        checks: checks.length,
        passed: checks.filter((c) => c.pass).length,
        failed: checks.filter((c) => !c.pass).length,
      },
      failed: checks.filter((c) => !c.pass),
    },
    null,
    2,
  ),
);
