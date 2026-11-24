import { load, q, log } from "./lib.mjs";

const state = load();
const admin = state.auditAdminToken;
const TOBRUK = "mh771k7xh059qpxfqwz19n2yk18jtewk";
const TOBRUK_CENTER = "mn7dcrfjwsfctbj30ran2d4gnn8jvyf2";
const MOE = "md75wrgfvxt6z0hkw4c644m29x8jvwwn";
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  log(`${pass ? "✓" : "✗"} ${name}`, pass ? "" : JSON.stringify(detail).slice(0, 500));
}

const institution = await q("adminOrgs:getInstitution", { id: TOBRUK }, admin);
check(
  "Institution detail preserves edited address/contact fields",
  institution.institution.address.includes("Tobruk") &&
    institution.institution.contactPerson === "AUDIT-1124 Test Liaison" &&
    institution.institution.website === "https://tu.edu.ly/",
  institution.institution,
);
const center = await q("adminOrgs:getTeachingCenter", { id: TOBRUK_CENTER }, admin);
check(
  "Teaching-center detail preserves edited contact info",
  center.center.contactInfo.includes("AUDIT-1124 updated"),
  center.center,
);
const facility = await q("adminOrgs:getGovernmentFacility", { id: MOE }, admin);
check(
  "Government-facility detail preserves department and contact fields",
  facility.facility.department.includes("Training and Development") &&
    facility.facility.email === "info@moe.edu.ly",
  facility.facility,
);

const institutionPerf = await q(
  "adminAnalytics:getInstitutionPerformance",
  { id: TOBRUK },
  admin,
);
const centerPerf = await q(
  "adminAnalytics:getTeachingCenterPerformance",
  { id: TOBRUK_CENTER },
  admin,
);
const facilityPerf = await q(
  "adminAnalytics:getFacilityPerformance",
  { id: MOE },
  admin,
);
check(
  "Institution performance report resolves the institution",
  institutionPerf?.institution?.name?.includes("Tobruk University") ||
    institutionPerf?.name?.includes("Tobruk University"),
  institutionPerf,
);
check(
  "Teaching-center performance report resolves the center and parent",
  JSON.stringify(centerPerf).includes("Language and Training Center"),
  centerPerf,
);
check(
  "Facility performance report resolves the facility",
  JSON.stringify(facilityPerf).includes("Ministry of Education"),
  facilityPerf,
);
check(
  "Institution report includes its current student",
  JSON.stringify(institutionPerf).includes("Org Visibility Student") ||
    JSON.stringify(institutionPerf).includes("Org Student"),
  institutionPerf,
);
check(
  "Center report includes its current student",
  JSON.stringify(centerPerf).includes("Org Visibility Student") ||
    JSON.stringify(centerPerf).includes("Org Student"),
  centerPerf,
);
check(
  "Facility report includes its current personnel/student",
  JSON.stringify(facilityPerf).includes("Org Visibility Student") ||
    JSON.stringify(facilityPerf).includes("Org Student"),
  facilityPerf,
);

log(
  JSON.stringify(
    {
      institutionPerf,
      centerPerf,
      facilityPerf,
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
