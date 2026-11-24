import { load, q, mut, log } from "./lib.mjs";

const state = load();
const admin = state.auditAdminToken;
const names = {
  "n17b0rk816n7dy1avx9nt6wm7d8jvcpq":
    "الرياضيات التطبيقية — تدريب المؤسسات (Applied Mathematics — Institutional Training)",
  "n17e4805wc7fe5ma5cxze99xd18jtahs":
    "الرياضيات — المجموعة التجريبية (Mathematics — Pilot Group)",
  "n176mzfzxm3b8q8ejch7vewtas8jtjb4":
    "برمجة بايثون — المستوى الأول (Python Programming — Level 1)",
  "n178m9wvgxnnfgad33msg5pwc58jt0xv":
    "الجبر — الصف الثاني عشر (Algebra — Grade 12)",
  "n17a4ssdzhbt5e1nnjfjsp8whh8j0xtm":
    "برمجة بايثون — المستوى الثاني (Python Programming — Level 2)",
  "n174jxqpg5gycbryz4pnh9rb4h8j11bv":
    "برمجة جافا — المستوى الأول (Java Programming — Level 1)",
  "n171chhyty4wv9s1a0de2snw098j0sf3":
    "برمجة ++C — المستوى الأول (C++ Programming — Level 1)",
  "n179hbdffmyghrc3hwtm9v5wg18j1cbp":
    "الخوارزميات وهياكل البيانات (Algorithms and Data Structures)",
  "n17a7h2deyxzgha5wyw3rk2bjd8j1n21":
    "الكيمياء العضوية — المستوى الأول (Organic Chemistry — Level 1)",
  "n17aa8ttm4vnfc4wjbgzsxhhs18j0rkc":
    "الفيزياء — الميكانيكا (Physics — Mechanics)",
  "n175snj5gzt5mass77hq5tpz698j187n":
    "قواعد اللغة الإنجليزية — المستوى المتوسط (English Grammar — Intermediate)",
  "n177yqwkyq9044283snj41qkmh8j0gah":
    "التفاضل والتكامل (Calculus)",
  "n17drveq91r43m7kzsk54p9at58j0kc1":
    "الجبر — المستوى التأسيسي (Algebra — Foundation)",
};
const classes = await q("adminClasses:listClasses", {}, admin);
const targets = classes.filter((c) => /^(TEST|AUDIT-1124)\b/.test(c.name));
for (const cls of targets) {
  const name = names[cls._id] ?? `${cls.subject ?? "المقرر"} — مجموعة تدريبية (Course Group)`;
  await mut(
    "adminClasses:updateClass",
    {
      id: cls._id,
      fields: {
        name,
        instructorId: cls.instructorId,
        institutionId: cls.institutionId,
        teachingCenterId: cls.teachingCenterId,
        description: cls.description,
        subject: cls.subject,
        categoryId: cls.categoryId,
      },
    },
    admin,
  );
}
const after = await q("adminClasses:listClasses", {}, admin);
const remaining = after.filter((c) => /^(TEST|AUDIT-1124)\b/.test(c.name));
log(
  JSON.stringify(
    {
      renamed: targets.length,
      remaining: remaining.map((c) => c.name),
      classes: after
        .filter((c) => targets.some((t) => t._id === c._id))
        .map((c) => ({ name: c.name, subject: c.subject })),
      pass: remaining.length === 0,
    },
    null,
    2,
  ),
);
