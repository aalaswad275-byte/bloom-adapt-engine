/**
 * Org-hierarchy audit — Institutions, Teaching Centers, Government Facilities.
 * Uses verified Libyan public organization names. Every record is marked as an
 * AUDIT-1124 test record in its description; no production record is edited.
 */
import { load, q, mut, log, anonymousToken } from "./lib.mjs";

const state = load();
const admin = state.auditAdminToken;
const suffix = Date.now();
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  log(`${pass ? "✓" : "✗"} ${name}`, pass ? "" : JSON.stringify(detail).slice(0, 500));
}
async function expectError(name, fn, includes) {
  try {
    const value = await fn();
    check(name, false, { got: value });
  } catch (err) {
    const message = String(err.message);
    check(
      name,
      !includes || message.toLowerCase().includes(includes.toLowerCase()),
      { message: message.slice(0, 350) },
    );
  }
}

// ---------------------------------------------------------------------------
// Create institutions (verified public Libyan institutions)
// ---------------------------------------------------------------------------
const institutionData = [
  {
    key: "tripoli",
    name: "University of Tripoli — جامعة طرابلس",
    type: "university",
    description:
      "AUDIT-1124 test record. Public university in Tripoli; official site uot.edu.ly.",
    address: "Tripoli, Libya",
    city: "Tripoli",
    region: "Tripoli",
    website: "https://uot.edu.ly/",
    contactPerson: "AUDIT-1124 Test Liaison",
  },
  {
    key: "benghazi",
    name: "University of Benghazi — جامعة بنغازي",
    type: "university",
    description:
      "AUDIT-1124 test record. Public university in Benghazi; official site uob.edu.ly.",
    address: "Benghazi, Libya",
    city: "Benghazi",
    region: "Benghazi",
    website: "https://uob.edu.ly/",
    contactPerson: "AUDIT-1124 Test Liaison",
  },
  {
    key: "academy",
    name: "Libyan Academy for Postgraduate Studies — الأكاديمية الليبية للدراسات العليا",
    type: "institute",
    description:
      "AUDIT-1124 test record. Public postgraduate institution based in Janzour, Tripoli; official site academy.edu.ly.",
    address: "Janzour, Tripoli, Libya",
    city: "Tripoli",
    region: "Tripoli",
    website: "https://academy.edu.ly/",
    contactPerson: "AUDIT-1124 Test Liaison",
  },
  {
    key: "tobruk",
    name: "Tobruk University — جامعة طبرق",
    type: "university",
    description:
      "AUDIT-1124 test record. Public university in Tobruk; official site tu.edu.ly.",
    address: "Tobruk, Libya",
    city: "Tobruk",
    region: "Butnan",
    website: "https://tu.edu.ly/",
    contactPerson: "AUDIT-1124 Test Liaison",
  },
];
const institutions = {};
for (const data of institutionData) {
  const { key, ...payload } = data;
  const id = await mut("adminOrgs:createInstitution", payload, admin);
  institutions[key] = { id, ...data };
  check(`Institution created: ${data.name}`, Boolean(id), { id });
}

// ---------------------------------------------------------------------------
// Create teaching centers (verified centers under public institutions)
// ---------------------------------------------------------------------------
const centerData = [
  {
    key: "tobrukLang",
    name: "Language and Training Center — مركز اللغات والتدريب",
    institutionKey: "tobruk",
    description:
      "AUDIT-1124 test record. Official Language and Training Center at Tobruk University (tu.edu.ly/ltc).",
    address: "Tobruk University, Tobruk, Libya",
    city: "Tobruk",
    contactInfo: "https://tu.edu.ly/ltc",
    manager: "AUDIT-1124 Test Manager",
  },
  {
    key: "academyHR",
    name: "Human Resources Development Institute and Language Center — معهد تنمية الموارد البشرية ومركز اللغات",
    institutionKey: "academy",
    description:
      "AUDIT-1124 test record. Institute and language center announced for the Libyan Academy's Al Jabal Al Akhdar branch.",
    address: "Al Bayda, Libya",
    city: "Al Bayda",
    contactInfo: "https://lajak.edu.ly/",
    manager: "AUDIT-1124 Test Manager",
  },
];
const centers = {};
for (const data of centerData) {
  const institutionId = institutions[data.institutionKey].id;
  const { key, institutionKey, ...payload } = data;
  const id = await mut(
    "adminOrgs:createTeachingCenter",
    { ...payload, institutionId },
    admin,
  );
  centers[key] = { id, ...data, institutionId };
  check(`Teaching center created: ${data.name}`, Boolean(id), { id });
}

// ---------------------------------------------------------------------------
// Create government facilities (verified Libyan public entities)
// ---------------------------------------------------------------------------
const facilityData = [
  {
    key: "moe",
    name: "Ministry of Education — وزارة التربية والتعليم",
    sector: "Education",
    department: "Training and Development (AUDIT-1124 test department)",
    description:
      "AUDIT-1124 test record. Official Libyan Ministry of Education; moe.gov.ly.",
    location: "Tripoli, Libya",
    contactPerson: "AUDIT-1124 Test Liaison",
    email: "info@moe.edu.ly",
    headcount: 250,
  },
  {
    key: "moh",
    name: "Ministry of Health — وزارة الصحة الليبية",
    sector: "Health",
    department: "Health Services (AUDIT-1124 test department)",
    description:
      "AUDIT-1124 test record. Official Libyan Ministry of Health; moh.gov.ly.",
    location: "Tripoli, Libya",
    contactPerson: "AUDIT-1124 Test Liaison",
    headcount: 300,
  },
  {
    key: "moi",
    name: "Ministry of Interior — وزارة الداخلية",
    sector: "Interior and Security",
    department: "Training and Recruitment (AUDIT-1124 test department)",
    description:
      "AUDIT-1124 test record. Official Libyan Ministry of Interior; csc.gov.ly entity page.",
    location: "Tripoli, Libya",
    contactPerson: "AUDIT-1124 Test Liaison",
    headcount: 400,
  },
  {
    key: "tripoliMunicipality",
    name: "Municipality of Tripoli Center — بلدية طرابلس المركز",
    sector: "Local Government",
    department: "Local Administration (AUDIT-1124 test department)",
    description:
      "AUDIT-1124 test record. Official municipality; tripoli.gov.ly.",
    location: "Tripoli, Libya",
    contactPerson: "AUDIT-1124 Test Liaison",
    headcount: 120,
  },
  {
    key: "tripoliCentral",
    name: "Tripoli Central Hospital — مستشفى طرابلس المركزي",
    sector: "Public Health",
    department: "Medical Training (AUDIT-1124 test department)",
    description:
      "AUDIT-1124 test record. Public teaching hospital in central Tripoli.",
    location: "Zawiya Street, Tripoli, Libya",
    contactPerson: "AUDIT-1124 Test Liaison",
    headcount: 180,
  },
  {
    key: "lana",
    name: "Libyan News Agency (LANA) — وكالة الأنباء الليبية",
    sector: "Media",
    department: "Editorial Training (AUDIT-1124 test department)",
    description:
      "AUDIT-1124 test record. Official national news agency; lana.gov.ly.",
    location: "Tripoli, Libya",
    contactPerson: "AUDIT-1124 Test Liaison",
    headcount: 90,
  },
];
const facilities = {};
for (const data of facilityData) {
  const { key, ...payload } = data;
  const id = await mut("adminOrgs:createGovernmentFacility", payload, admin);
  facilities[key] = { id, ...data };
  check(`Government facility created: ${data.name}`, Boolean(id), { id });
}

// ---------------------------------------------------------------------------
// Edit and status lifecycle
// ---------------------------------------------------------------------------
const { id: tobrukId, key: _tk, ...tobrukFields } = institutions.tobruk;
await mut(
  "adminOrgs:updateInstitution",
  {
    id: tobrukId,
    fields: { ...tobrukFields, description: `${tobrukFields.description} Updated address verified.` },
  },
  admin,
);
const { id: tobrukCenterId, key: _ck, institutionKey: _ik, ...tobrukCenterFields } =
  centers.tobrukLang;
await mut(
  "adminOrgs:updateTeachingCenter",
  {
    id: tobrukCenterId,
    fields: { ...tobrukCenterFields, contactInfo: "https://tu.edu.ly/ltc (AUDIT-1124 updated)" },
  },
  admin,
);
const { id: tripoliCentralId, key: _fk, ...tripoliCentralFields } =
  facilities.tripoliCentral;
await mut(
  "adminOrgs:updateGovernmentFacility",
  {
    id: tripoliCentralId,
    fields: { ...tripoliCentralFields, department: "Medical Training and Development (AUDIT-1124 test department)" },
  },
  admin,
);

for (const [entity, id] of [
  ["setInstitutionStatus", institutions.academy.id],
  ["setTeachingCenterStatus", centers.academyHR.id],
  ["setGovernmentFacilityStatus", facilities.lana.id],
]) {
  await mut(`adminOrgs:${entity}`, { id, status: "inactive" }, admin);
}
const inactiveInstitutions = await q(
  "adminOrgs:listInstitutions",
  { status: "inactive" },
  admin,
);
const inactiveCenters = await q(
  "adminOrgs:listTeachingCenters",
  { status: "inactive" },
  admin,
);
const inactiveFacilities = await q(
  "adminOrgs:listGovernmentFacilities",
  { status: "inactive" },
  admin,
);
check(
  "Institution deactivation is visible through the status filter",
  inactiveInstitutions.some((i) => i._id === institutions.academy.id),
  inactiveInstitutions.map((i) => i.name),
);
check(
  "Teaching-center deactivation is visible through the status filter",
  inactiveCenters.some((c) => c._id === centers.academyHR.id),
  inactiveCenters.map((c) => c.name),
);
check(
  "Government-facility deactivation is visible through the status filter",
  inactiveFacilities.some((f) => f._id === facilities.lana.id),
  inactiveFacilities.map((f) => f.name),
);
for (const [entity, id] of [
  ["setInstitutionStatus", institutions.academy.id],
  ["setTeachingCenterStatus", centers.academyHR.id],
  ["setGovernmentFacilityStatus", facilities.lana.id],
]) {
  await mut(`adminOrgs:${entity}`, { id, status: "active" }, admin);
}

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------
const arabicInstitutionSearch = await q(
  "adminOrgs:listInstitutions",
  { search: "طرابلس" },
  admin,
);
check(
  "Arabic institution search finds the Tripoli institution",
  arabicInstitutionSearch.some((i) => i.name.includes("جامعة طرابلس")),
  arabicInstitutionSearch.map((i) => i.name),
);
const englishFacilitySearch = await q(
  "adminOrgs:listGovernmentFacilities",
  { search: "Ministry" },
  admin,
);
check(
  "English facility search finds the ministries",
  englishFacilitySearch.length >= 3,
  englishFacilitySearch.map((f) => f.name),
);
const arabicFacilitySearch = await q(
  "adminOrgs:listGovernmentFacilities",
  { search: "بلدية" },
  admin,
);
check(
  "Arabic facility search finds the municipality",
  arabicFacilitySearch.some((f) => f.name.includes("بلدية طرابلس المركز")),
  arabicFacilitySearch.map((f) => f.name),
);
const centerSearch = await q(
  "adminOrgs:listTeachingCenters",
  { search: "Tobruk" },
  admin,
);
check(
  "Teaching-center search and parent filter resolve the institution",
  centerSearch.some(
    (c) => c._id === centers.tobrukLang.id && c.institutionName.includes("Tobruk"),
  ),
  centerSearch.map((c) => ({ name: c.name, parent: c.institutionName })),
);

// ---------------------------------------------------------------------------
// Relationships: instructor → class → student across all three org types
// ---------------------------------------------------------------------------
const instructorEmail = `audit.1124.org.instructor.${suffix}@example.test`;
const instructorId = await mut(
  "adminPeople:createInstructor",
  {
    name: "AUDIT-1124 Org Instructor",
    email: instructorEmail,
    institutionId: institutions.tobruk.id,
    teachingCenterId: centers.tobrukLang.id,
    governmentFacilityId: facilities.moe.id,
    specialization: "Mathematics",
  },
  admin,
);
const instructorToken = await anonymousToken();
await mut(
  "instructorPortal:claimInstructor",
  { email: instructorEmail },
  instructorToken,
);
const classId = await mut(
  "adminClasses:createClass",
  {
    name: `AUDIT-1124 Org Relations ${suffix}`,
    instructorId,
    institutionId: institutions.tobruk.id,
    teachingCenterId: centers.tobrukLang.id,
    subject: "Mathematics",
    description: "AUDIT-1124 organization-relationship test class.",
  },
  admin,
);
const studentEmail = `audit.1124.org.student.${suffix}@example.test`;
const studentId = await mut(
  "adminPeople:createStudent",
  {
    name: "AUDIT-1124 Org Student",
    email: studentEmail,
    institutionId: institutions.tobruk.id,
    teachingCenterId: centers.tobrukLang.id,
    governmentFacilityId: facilities.moe.id,
  },
  admin,
);
const studentToken = await anonymousToken();
await mut("studentAssessments:claimStudent", { email: studentEmail }, studentToken);
await mut(
  "instructorPortal:addStudentToMyClass",
  { classId, studentId },
  instructorToken,
);

const tobrukRow = (await q("adminOrgs:listInstitutions", { search: "Tobruk" }, admin)).find(
  (i) => i._id === institutions.tobruk.id,
);
check(
  "Institution counts include its center, instructor and student",
  tobrukRow?.centerCount >= 1 &&
    tobrukRow?.instructorCount >= 1 &&
    tobrukRow?.studentCount >= 1,
  tobrukRow,
);
const centerRow = (
  await q("adminOrgs:listTeachingCenters", { institutionId: institutions.tobruk.id }, admin)
).find((c) => c._id === centers.tobrukLang.id);
check(
  "Teaching-center counts include its instructor and student",
  centerRow?.instructorCount >= 1 && centerRow?.studentCount >= 1,
  centerRow,
);
const facilityRow = (
  await q("adminOrgs:listGovernmentFacilities", { search: "Ministry of Education" }, admin)
).find((f) => f._id === facilities.moe.id);
check(
  "Government-facility personnel count includes the assigned student",
  facilityRow?.personnelCount >= 1,
  facilityRow,
);
const institutionDetail = await q(
  "adminOrgs:getInstitution",
  { id: institutions.tobruk.id },
  admin,
);
check(
  "Institution detail lists its center, instructor, and student",
  institutionDetail.centers.some((c) => c._id === centers.tobrukLang.id) &&
    institutionDetail.instructors.some((i) => i._id === instructorId) &&
    institutionDetail.students.some((s) => s._id === studentId),
  {
    centers: institutionDetail.centers.length,
    instructors: institutionDetail.instructors.length,
    students: institutionDetail.students.length,
  },
);
const centerDetail = await q(
  "adminOrgs:getTeachingCenter",
  { id: centers.tobrukLang.id },
  admin,
);
check(
  "Teaching-center detail resolves parent institution, instructor, and student",
  centerDetail.institution?._id === institutions.tobruk.id &&
    centerDetail.instructors.some((i) => i._id === instructorId) &&
    centerDetail.students.some((s) => s._id === studentId),
  {
    institution: centerDetail.institution?.name,
    instructors: centerDetail.instructors.length,
    students: centerDetail.students.length,
  },
);
const facilityDetail = await q(
  "adminOrgs:getGovernmentFacility",
  { id: facilities.moe.id },
  admin,
);
check(
  "Government-facility detail lists the assigned student",
  facilityDetail.students.some((s) => s._id === studentId),
  { students: facilityDetail.students.length },
);

const adminClass = (await q("adminClasses:listClasses", { search: "Org Relations" }, admin)).find(
  (c) => c._id === classId,
);
check(
  "Class stores its institution and teaching-center assignments",
  adminClass?.institutionId === institutions.tobruk.id &&
    adminClass?.teachingCenterId === centers.tobrukLang.id,
  adminClass && {
    institutionId: adminClass.institutionId,
    teachingCenterId: adminClass.teachingCenterId,
  },
);
const instructorDashboard = await q(
  "instructorPortal:getInstructorDashboard",
  {},
  instructorToken,
);
check(
  "Instructor dashboard shows the organization-linked class",
  instructorDashboard.classes.some((c) => c.id === classId && c.studentCount >= 1),
  instructorDashboard.classes.map((c) => ({ id: c.id, students: c.studentCount })),
);
const studentClasses = await q("studentAssessments:getMyClass", {}, studentToken);
check(
  "Student panel shows the class and its instructor",
  studentClasses.classes.some(
    (c) => c.id === classId && c.instructorName === "AUDIT-1124 Org Instructor",
  ),
  studentClasses.classes.map((c) => ({ id: c.id, instructor: c.instructorName })),
);

// ---------------------------------------------------------------------------
// Deletion guards and clean deletion of empty records
// ---------------------------------------------------------------------------
await expectError(
  "Institution with children cannot be deleted",
  () => mut("adminOrgs:deleteInstitution", { id: institutions.tobruk.id }, admin),
  "cannot delete",
);
await expectError(
  "Teaching center with people cannot be deleted",
  () => mut("adminOrgs:deleteTeachingCenter", { id: centers.tobrukLang.id }, admin),
  "cannot delete",
);
await expectError(
  "Government facility with personnel cannot be deleted",
  () => mut("adminOrgs:deleteGovernmentFacility", { id: facilities.moe.id }, admin),
  "cannot delete",
);

const emptyInstitutionId = await mut(
  "adminOrgs:createInstitution",
  {
    name: `AUDIT-1124 Disposable Institution ${suffix}`,
    type: "other",
    description: "AUDIT-1124 disposable test record.",
    city: "Tripoli",
  },
  admin,
);
const emptyCenterId = await mut(
  "adminOrgs:createTeachingCenter",
  {
    name: `AUDIT-1124 Disposable Center ${suffix}`,
    institutionId: emptyInstitutionId,
    description: "AUDIT-1124 disposable test record.",
    city: "Tripoli",
  },
  admin,
);
await mut("adminOrgs:deleteTeachingCenter", { id: emptyCenterId }, admin);
await mut("adminOrgs:deleteInstitution", { id: emptyInstitutionId }, admin);
const emptyFacilityId = await mut(
  "adminOrgs:createGovernmentFacility",
  {
    name: `AUDIT-1124 Disposable Facility ${suffix}`,
    sector: "Test",
    description: "AUDIT-1124 disposable test record.",
    location: "Tripoli",
  },
  admin,
);
await mut(
  "adminOrgs:deleteGovernmentFacility",
  { id: emptyFacilityId },
  admin,
);
check("Empty organization records delete cleanly", true, null);

// ---------------------------------------------------------------------------
// Permission boundaries
// ---------------------------------------------------------------------------
await expectError(
  "Student cannot list institutions",
  () => q("adminOrgs:listInstitutions", {}, studentToken),
  "admin",
);
await expectError(
  "Instructor cannot create a government facility",
  () =>
    mut(
      "adminOrgs:createGovernmentFacility",
      { name: "AUDIT-1124 forbidden", sector: "Test" },
      instructorToken,
    ),
  "admin",
);

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------
const logs = await q("adminAnalytics:listAuditLogs", { limit: 1000 }, admin);
const orgLogs = logs.filter((l) =>
  /^(institution|teaching_center|government_facility)\./.test(l.action),
);
const expectedActions = [
  "institution.created",
  "institution.updated",
  "institution.deactivated",
  "institution.activated",
  "teaching_center.created",
  "teaching_center.updated",
  "teaching_center.deleted",
  "government_facility.created",
  "government_facility.updated",
  "government_facility.deleted",
];
check(
  "All organization CRUD/status actions are audit-logged",
  expectedActions.every((action) => orgLogs.some((l) => l.action === action)),
  {
    found: [...new Set(orgLogs.map((l) => l.action))],
    missing: expectedActions.filter(
      (action) => !orgLogs.some((l) => l.action === action),
    ),
  },
);
check(
  "Organization audit rows carry actor and timestamp",
  orgLogs.some((l) => l.actorEmail && l.timestamp),
  orgLogs.slice(0, 2),
);

const counts = {
  institutions: (await q("adminOrgs:listInstitutions", {}, admin)).length,
  teachingCenters: (await q("adminOrgs:listTeachingCenters", {}, admin)).length,
  governmentFacilities: (await q("adminOrgs:listGovernmentFacilities", {}, admin)).length,
};
log(
  JSON.stringify(
    {
      created: {
        institutions,
        centers,
        facilities,
        instructorId,
        classId,
        studentId,
      },
      counts,
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
