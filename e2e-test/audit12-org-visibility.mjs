import { load, q, mut, log, anonymousToken } from "./lib.mjs";

const state = load();
const admin = state.auditAdminToken;
const suffix = Date.now();
const TOBRUK = "mh771k7xh059qpxfqwz19n2yk18jtewk";
const TOBRUK_CENTER = "mn7dcrfjwsfctbj30ran2d4gnn8jvyf2";
const MOE = "md75wrgfvxt6z0hkw4c644m29x8jvwwn";
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  log(`${pass ? "✓" : "✗"} ${name}`, pass ? "" : JSON.stringify(detail).slice(0, 400));
}

const email = `audit.1124.org.visibility.${suffix}@example.test`;
const studentId = await mut(
  "adminPeople:createStudent",
  {
    name: "AUDIT-1124 Org Visibility Student",
    email,
    institutionId: TOBRUK,
    teachingCenterId: TOBRUK_CENTER,
    governmentFacilityId: MOE,
  },
  admin,
);
const token = await anonymousToken();
await mut("studentAssessments:claimStudent", { email }, token);
const profile = await q("studentAssessments:getMyProfile", {}, token);
check(
  "Student profile shows the assigned institution name",
  typeof profile.institutionName === "string" &&
    profile.institutionName.includes("Tobruk University"),
  { institutionName: profile.institutionName },
);
check(
  "Student profile shows the assigned teaching-center name",
  typeof profile.teachingCenterName === "string" &&
    profile.teachingCenterName.includes("Language and Training Center"),
  { teachingCenterName: profile.teachingCenterName },
);
check(
  "Student profile has no government-facility field (facility assignment is invisible to the student)",
  !("governmentFacilityName" in profile) && !("facilityName" in profile),
  Object.keys(profile),
);

const adminStudents = await q(
  "adminPeople:listStudents",
  { search: "Org Visibility" },
  admin,
);
const row = adminStudents.find((s) => s._id === studentId);
check(
  "Admin student record persists the facility assignment",
  row?.governmentFacilityId === MOE,
  { governmentFacilityId: row?.governmentFacilityId ?? null },
);

const facilityDetail = await q(
  "adminOrgs:getGovernmentFacility",
  { id: MOE },
  admin,
);
check(
  "Facility detail does not return its directly assigned instructors",
  !("instructors" in facilityDetail),
  Object.keys(facilityDetail),
);
const facilityRows = await q(
  "adminOrgs:listGovernmentFacilities",
  { search: "Ministry of Education" },
  admin,
);
const facilityRow = facilityRows.find((f) => f._id === MOE);
check(
  "Facility list personnel count only reflects students, not instructors",
  typeof facilityRow?.personnelCount === "number" && !("instructorCount" in facilityRow),
  facilityRow && {
    personnelCount: facilityRow.personnelCount,
    keys: Object.keys(facilityRow),
  },
);

log(
  JSON.stringify(
    {
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
