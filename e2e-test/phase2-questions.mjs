/**
 * Phase 2 — 18 questions per test class (3 per Bloom level), authored by the
 * class's own instructor through createQuestion. Two questions per class are
 * then published to the shared bank through the real share mutation.
 */
import { load, mut, q, save, log } from "./lib.mjs";

const BLOOMS = ["remember", "understand", "apply", "analyze", "evaluate", "create"];
const DIFFICULTY = {
  remember: "easy",
  understand: "easy",
  apply: "medium",
  analyze: "medium",
  evaluate: "hard",
  create: "expert",
};
const MARKS = {
  remember: 1,
  understand: 1,
  apply: 2,
  analyze: 2,
  evaluate: 3,
  create: 3,
};
const TIME = {
  remember: 30,
  understand: 45,
  apply: 60,
  analyze: 90,
  evaluate: 120,
  create: 180,
};
const TYPES = ["multiple_choice", "true_false", "short_answer"];

/** Topic-specific stem data. */
function base(topic, n) {
  switch (topic) {
    case "Algebra": {
      const a = 2 + (n % 5);
      const x = 1 + (n % 9);
      const b = 3 + (n % 7);
      const c = a * x + b;
      return {
        prompt: `${a}x + ${b} = ${c}`,
        answer: String(x),
        wrong: [String(x + 1), String(x - 1), String(x + 2)],
        trueStatement: `The equation ${a}x + ${b} = ${c} has the solution x = ${x}.`,
        falseStatement: `The equation ${a}x + ${b} = ${c} has the solution x = ${x + 2}.`,
        explain: `${a}(${x}) + ${b} = ${c}.`,
      };
    }
    case "Calculus": {
      const p = 2 + (n % 4);
      const coef = p * (1 + (n % 3));
      return {
        prompt: `f(x) = ${coef / p}x^${p}`,
        answer: `${coef}x^${p - 1}`,
        wrong: [`${coef}x^${p}`, `${p}x^${p - 1}`, `${coef / p}x^${p - 1}`],
        trueStatement: `The derivative of ${coef / p}x^${p} is ${coef}x^${p - 1}.`,
        falseStatement: `The derivative of ${coef / p}x^${p} is ${coef}x^${p}.`,
        explain: `Power rule: d/dx ax^n = n·a·x^(n−1).`,
      };
    }
    case "Geometry": {
      const w = 3 + (n % 6);
      const h = 2 + (n % 5);
      return {
        prompt: `a rectangle with width ${w} and height ${h}`,
        answer: String(w * h),
        wrong: [String(w * h + 2), String(2 * (w + h)), String(w + h)],
        trueStatement: `The area of the rectangle is ${w * h} square units.`,
        falseStatement: `The area of the rectangle is ${w + h} square units.`,
        explain: `Area = width × height = ${w} × ${h} = ${w * h}.`,
      };
    }
    case "Grammar": {
      const subjects = ["She", "He", "The student", "My brother"];
      const s = subjects[n % subjects.length];
      const verbs = ["writes", "reads", "studies", "practises"];
      const v = verbs[(n + 1) % verbs.length];
      return {
        prompt: `Choose the correct present-tense verb: "${s} ___ every day."`,
        answer: v,
        wrong: [`${v.replace(/s$/, "")}ing`, `to ${v}`, `${v}ed`],
        trueStatement: `"${s} ${v} every day" uses the third-person singular verb form.`,
        falseStatement: `"${s} ${v} every day" uses the base form of the verb.`,
        explain: `Third-person singular subjects take the -s form: ${v}.`,
      };
    }
    case "Mechanics": {
      const m = 2 + (n % 8);
      const a = 2 + (n % 5);
      return {
        prompt: `a mass of ${m} kg accelerating at ${a} m/s²`,
        answer: `${m * a} N`,
        wrong: [`${m + a} N`, `${m * a * 2} N`, `${a} N`],
        trueStatement: `The net force is ${m * a} N when ${m} kg accelerates at ${a} m/s².`,
        falseStatement: `The net force is ${m + a} N when ${m} kg accelerates at ${a} m/s².`,
        explain: `F = m·a = ${m} × ${a} = ${m * a} N.`,
      };
    }
    case "Organic Chemistry": {
      const nC = 1 + (n % 5);
      const h = 2 * nC + 2;
      return {
        prompt: `the alkane with ${nC} carbon atom${nC === 1 ? "" : "s"}`,
        answer: `C${nC}H${h}`,
        wrong: [`C${nC}H${2 * nC}`, `C${nC}H${h + 2}`, `C${nC + 1}H${h}`],
        trueStatement: `The molecular formula of the alkane with ${nC} carbon atoms is C${nC}H${h}.`,
        falseStatement: `The molecular formula of the alkane with ${nC} carbon atoms is C${nC}H${2 * nC}.`,
        explain: `Alkanes follow CₙH₂ₙ₊₂, so C${nC}H${h}.`,
      };
    }
    case "Algorithms": {
      const sizes = [10, 100, 1000, 10000];
      const keys = ["O(1)", "O(log n)", "O(n)", "O(n log n)", "O(n²)"];
      const k = keys[n % keys.length];
      return {
        prompt: `an algorithm whose work grows as ${k}`,
        answer: k,
        wrong: keys.filter((x) => x !== k).slice(0, 3),
        trueStatement: `Binary search on a sorted array runs in ${k === "O(log n)" ? "O(log n)" : "O(log n)"} time in the average case.`,
        falseStatement: `Binary search on a sorted array runs in O(n²) time in the average case.`,
        explain: `Binary search halves the search space each step, giving O(log n).`,
      };
    }
    case "C++":
    case "Java":
    case "Python": {
      const lang = topic;
      const nums = [3 + (n % 5), 2 + (n % 4)];
      const sum = nums[0] + nums[1];
      return {
        prompt:
          lang === "Python"
            ? `x = ${nums[0]}\ny = ${nums[1]}\nprint(x + y)`
            : `int x = ${nums[0]};\nint y = ${nums[1]};\nSystem.out.println(x + y);`,
        answer: String(sum),
        wrong: [String(sum + 1), String(nums[0] * nums[1]), String(Math.abs(nums[0] - nums[1]))],
        trueStatement: `The ${lang} snippet prints ${sum}.`,
        falseStatement: `The ${lang} snippet prints ${nums[0] * nums[1]}.`,
        explain: `x + y = ${nums[0]} + ${nums[1]} = ${sum}.`,
      };
    }
    default: {
      const n1 = 2 + (n % 9);
      return {
        prompt: `the number ${n1} doubled`,
        answer: String(n1 * 2),
        wrong: [String(n1 + 2), String(n1 * 3), String(n1)],
        trueStatement: `Twice ${n1} is ${n1 * 2}.`,
        falseStatement: `Twice ${n1} is ${n1 + 2}.`,
        explain: `2 × ${n1} = ${n1 * 2}.`,
      };
    }
  }
}

const STEM = {
  remember: (b) => `What is the answer for ${b.prompt}?`,
  understand: (b) => `Which option correctly describes ${b.prompt}?`,
  apply: (b) => `Apply the rule and solve: ${b.prompt}.`,
  analyze: (b) => `A student is analysing ${b.prompt}. Which result is correct?`,
  evaluate: (b) => `Evaluate the following and choose the correct conclusion for ${b.prompt}.`,
  create: (b) => `Construct the correct result for ${b.prompt}.`,
};

function build(topic, bloom, seq) {
  const type = TYPES[seq % 3];
  const b = base(topic, seq + BLOOMS.indexOf(bloom) * 3);
  if (type === "true_false") {
    const isTrue = seq % 2 === 0;
    return {
      questionType: "true_false",
      options: undefined,
      questionText: `TEST ${topic}: ${isTrue ? b.trueStatement : b.falseStatement}`,
      correctAnswer: isTrue ? "True" : "False",
      explanation: `${b.explain} ${isTrue ? "The statement is true." : "The statement is false."}`,
    };
  }
  if (type === "short_answer") {
    return {
      questionType: "short_answer",
      options: undefined,
      questionText: `TEST ${topic}: ${STEM[bloom](b)} Give the exact answer.`,
      correctAnswer: b.answer,
      explanation: b.explain,
    };
  }
  const options = [b.answer, ...b.wrong.slice(0, 3)];
  return {
    questionType: "multiple_choice",
    options,
    questionText: `TEST ${topic}: ${STEM[bloom](b)}`,
    correctAnswer: b.answer,
    explanation: b.explain,
  };
}

const state = load();
const admin = state.adminToken;
const taxonomy = await q("taxonomy:getTaxonomy", {}, admin);
const topicId = (categoryName, topicName) =>
  taxonomy.categories
    .find((c) => c.name === categoryName)
    ?.topics.find((t) => t.name === topicName)?.id;

const TOPIC_FOR_CLASS = {
  "TEST — Algebra (Mathematics)": "Algebra",
  "TEST — Calculus (Mathematics)": "Calculus",
  "TEST — English Grammar": "Grammar",
  "TEST — Physics: Mechanics": "Mechanics",
  "TEST — Organic Chemistry": "Organic Chemistry",
  "TEST — Algorithms (CS)": "Algorithms",
  "TEST — Programming: C++": "C++",
  "TEST — Programming: Java": "Java",
  "TEST — Programming: Python": "Python",
};

state.questions = state.questions ?? {};
for (const cls of state.classes) {
  if (state.questions[cls.id]?.length >= 18) continue;
  const instructor = state.instructors.find((i) => i.id === cls.instructorId);
  const topic = TOPIC_FOR_CLASS[cls.name];
  const tid = topicId(cls.subject, topic);
  const rows = [];
  for (const bloom of BLOOMS) {
    for (let k = 0; k < 3; k++) {
      const qd = build(topic, bloom, k + BLOOMS.indexOf(bloom) * 3);
      const args = {
        classId: cls.id,
        categoryId: cls.categoryId,
        topicId: tid,
        typeKey: qd.questionType,
        questionText: qd.questionText,
        questionType: qd.questionType,
        correctAnswer: qd.correctAnswer,
        explanation: qd.explanation,
        marks: MARKS[bloom],
        bloomLevel: bloom,
        difficultyLevel: DIFFICULTY[bloom],
        expectedTimeSec: TIME[bloom],
        source: "manual",
        ...(qd.options ? { options: qd.options } : {}),
      };
      const id = await mut(
        "instructorAssessments:createQuestion",
        args,
        instructor.token,
      );
      rows.push({
        id,
        questionText: qd.questionText,
        questionType: qd.questionType,
        options: qd.options ?? null,
        correctAnswer: qd.correctAnswer,
        bloomLevel: bloom,
        difficultyLevel: DIFFICULTY[bloom],
        marks: MARKS[bloom],
        expectedTimeSec: TIME[bloom],
      });
    }
  }
  state.questions[cls.id] = rows;
  save(state);
  log(`questions ${cls.name}: ${rows.length}`);

  // Publish two questions to the shared bank (real share workflow).
  for (const row of rows.slice(0, 2)) {
    if (!row.shared) {
      await mut(
        "sharedQuestions:setBankQuestionShare",
        { questionId: row.id, share: true },
        instructor.token,
      );
      row.shared = true;
    }
  }
  save(state);
}

log(
  JSON.stringify(
    Object.fromEntries(
      state.classes.map((c) => [c.name, state.questions[c.id]?.length ?? 0]),
    ),
    null,
    2,
  ),
);
