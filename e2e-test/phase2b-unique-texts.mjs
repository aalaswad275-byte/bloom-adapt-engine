/**
 * Phase 2b — make every generated question stem unique by appending its
 * position. Template parameters can repeat across Bloom levels, and identical
 * stems make both the answer key and the paper confusing.
 */
import { load, mut, save, log } from "./lib.mjs";

const state = load();
let updated = 0;
for (const cls of state.classes) {
  const instructor = state.instructors.find((i) => i.id === cls.instructorId);
  const rows = state.questions[cls.id] ?? [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.questionText.endsWith(`[Q${i + 1}]`)) continue;
    const text = `${row.questionText.replace(/\s*\[Q\d+\]$/, "")} [Q${i + 1}]`;
    await mut(
      "instructorAssessments:updateQuestion",
      { id: row.id, fields: { questionText: text } },
      instructor.token,
    );
    row.questionText = text;
    updated += 1;
  }
  save(state);
}
log(JSON.stringify({ updated }, null, 2));
