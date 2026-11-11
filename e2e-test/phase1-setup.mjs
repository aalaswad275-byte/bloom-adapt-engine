/**
 * Phase 1 — admin login, subject taxonomy, 5 test instructors, 9 test classes.
 * Everything is prefixed TEST and created through the real admin/instructor
 * mutations. Re-running reuses records already recorded in the state file.
 */
import {
  adminToken,
  anonymousToken,
  load,
  mut,
  q,
  save,
  log,
} from "./lib.mjs";

const SUBJECTS = [
  "Mathematics",
  "English",
  "Physics",
  "Chemistry",
  "Computer Science",
];

const INSTRUCTORS = [
  {
    key: "math",
    name: "TEST Instructor — Mathematics",
    email: "test.e2e.math@example.test",
    specialization: "Mathematics",
  },
  {
    key: "english",
    name: "TEST Instructor — English",
    email: "test.e2e.english@example.test",
    specialization: "English",
  },
  {
    key: "physics",
    name: "TEST Instructor — Physics",
    email: "test.e2e.physics@example.test",
    specialization: "Physics",
  },
  {
    key: "cs",
    name: "TEST Instructor — Computer Science",
    email: "test.e2e.cs@example.test",
    specialization: "Computer Science",
  },
  {
    key: "chem",
    name: "TEST Instructor — Chemistry",
    email: "test.e2e.chem@example.test",
    specialization: "Chemistry",
  },
];

const CLASSES = [
  { name: "TEST — Algebra (Mathematics)", subject: "Mathematics", instructor: "math" },
  { name: "TEST — Calculus (Mathematics)", subject: "Mathematics", instructor: "math" },
  { name: "TEST — English Grammar", subject: "English", instructor: "english" },
  { name: "TEST — Physics: Mechanics", subject: "Physics", instructor: "physics" },
  { name: "TEST — Organic Chemistry", subject: "Chemistry", instructor: "chem" },
  { name: "TEST — Algorithms (CS)", subject: "Computer Science", instructor: "cs" },
  { name: "TEST — Programming: C++", subject: "Computer Science", instructor: "cs" },
  { name: "TEST — Programming: Java", subject: "Computer Science", instructor: "cs" },
  { name: "TEST — Programming: Python", subject: "Computer Science", instructor: "cs" },
];

const state = load();
const admin = await adminToken();
state.adminToken = admin;

// ---- Taxonomy -------------------------------------------------------------
let taxonomy = await q("taxonomy:getTaxonomy", {}, admin);
const categoryByName = new Map(taxonomy.categories.map((c) => [c.name, c]));
for (const subject of SUBJECTS) {
  if (!categoryByName.has(subject)) {
    const id = await mut(
      "taxonomy:createCategory",
      { name: subject, description: `E2E test subject — ${subject}` },
      admin,
    );
    log(`created category ${subject}`);
    categoryByName.set(subject, { id, name: subject, topics: [] });
  }
}
taxonomy = await q("taxonomy:getTaxonomy", {}, admin);
const categories = {};
for (const subject of SUBJECTS) {
  const cat = taxonomy.categories.find((c) => c.name === subject);
  if (!cat) throw new Error(`category missing: ${subject}`);
  categories[subject] = { id: cat.id, topics: cat.topics.map((t) => t.name) };
}
state.categories = categories;

// ---- Instructors ----------------------------------------------------------
state.instructors = state.instructors ?? [];
for (const spec of INSTRUCTORS) {
  let rec = state.instructors.find((i) => i.identity === spec.email);
  if (!rec) {
    const id = await mut(
      "adminPeople:createInstructor",
      {
        name: spec.name,
        email: spec.email,
        specialization: spec.specialization,
      },
      admin,
    );
    const token = await anonymousToken();
    await mut("instructorPortal:claimInstructor", { email: spec.email }, token);
    rec = { id, identity: spec.email, token, key: spec.key };
    state.instructors.push(rec);
    log(`created instructor ${spec.name}`);
  } else if (!rec.token) {
    rec.token = await anonymousToken();
    await mut(
      "instructorPortal:claimInstructor",
      { email: spec.email },
      rec.token,
    );
  }
  save(state);
}

// ---- Classes --------------------------------------------------------------
state.classes = state.classes ?? [];
for (const spec of CLASSES) {
  if (state.classes.some((c) => c.name === spec.name)) continue;
  const instructor = state.instructors.find((i) => i.key === spec.instructor);
  const id = await mut(
    "instructorPortal:createMyClass",
    {
      name: spec.name,
      description: `E2E test class for ${spec.subject}`,
      categoryId: categories[spec.subject].id,
    },
    instructor.token,
  );
  state.classes.push({
    id,
    name: spec.name,
    subject: spec.subject,
    categoryId: categories[spec.subject].id,
    instructorId: instructor.id,
    instructorKey: instructor.key,
    instructorIdentity: instructor.identity,
  });
  save(state);
  log(`created class ${spec.name}`);
}

const summary = {
  categories: Object.keys(state.categories).length,
  instructors: state.instructors.length,
  classes: state.classes.length,
  classNames: state.classes.map((c) => c.name),
};
log(JSON.stringify(summary, null, 2));
