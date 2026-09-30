/**
 * AI question generation — calls OpenAI (gpt-4o-mini, JSON mode) to draft
 * questions from a topic + Bloom level + type + difficulty. The action only
 * GENERATES; persistence goes through the ownership-checked createQuestion
 * mutation, so every AI question is linked to the caller's class/instructor.
 */

"use node";

import { v } from "convex/values";
import OpenAI from "openai";
import { action, type QueryCtx } from "./_generated/server";
import { api } from "./_generated/api";

const BLOOM = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

type BloomKey = (typeof BLOOM)[number];

type DraftQuestion = {
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options: string[] | null;
  correctAnswer: string;
  explanation: string;
  marks: number;
  expectedTimeSec: number;
};

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? Math.round(v) : parseInt(String(v ?? ""), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function normalizeDrafts(raw: unknown, count: number): DraftQuestion[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: DraftQuestion[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "number" === false && typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = String(o.questionText ?? o.question ?? "").trim();
    if (!text) continue;
    let type: DraftQuestion["questionType"] = "multiple_choice";
    const rawType = String(o.questionType ?? "multiple_choice");
    if (rawType === "true_false") type = "true_false";
    else if (rawType === "short_answer") type = "short_answer";
    let options: string[] | null = null;
    let correct = String(o.correctAnswer ?? o.correct_answer ?? "").trim();
    if (type === "true_false") {
      options = ["True", "False"];
      correct = correct.toLowerCase().startsWith("f") ? "False" : "True";
    } else if (type === "multiple_choice") {
      const opts = Array.isArray(o.options) ? o.options.map((x) => String(x).trim()).filter(Boolean) : [];
      options = opts.length >= 2 ? opts.slice(0, 6) : ["Option A", "Option B"];
      if (!options.includes(correct)) correct = options[0];
    }
    out.push({
      questionText: text.slice(0, 500),
      questionType: type,
      options,
      correctAnswer: correct,
      explanation: String(o.explanation ?? "").slice(0, 500),
      marks: clampInt(o.marks, 1, 100, 1),
      expectedTimeSec: clampInt(o.expectedTimeSec, 10, 7200, 60),
    });
    if (out.length >= count) break;
  }
  return out;
}

/** Generate draft questions (not persisted). Requires OPENAI_API_KEY. */
export const generateQuestions = action({
  args: {
    classId: v.id("classes"),
    topic: v.string(),
    count: v.number(),
    bloomLevel: v.union(
      v.literal("remember"),
      v.literal("understand"),
      v.literal("apply"),
      v.literal("analyze"),
      v.literal("evaluate"),
      v.literal("create"),
    ),
    questionType: v.union(
      v.literal("multiple_choice"),
      v.literal("true_false"),
      v.literal("short_answer"),
      v.literal("mixed"),
    ),
    difficulty: v.union(
      v.literal("easy"),
      v.literal("medium"),
      v.literal("hard"),
    ),
    marks: v.number(),
    expectedTimeSec: v.number(),
  },
  handler: async (ctx, args) => {
    // Ownership: reuse the instructor-portal guard inside this class.
    await ctx.runQuery(api.instructorAssessments.getClassContext, {
      classId: args.classId,
    });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
      throw new Error(
        "OPENAI_API_KEY is not configured — add it in the Keys/API keys tab.",
      );
    const openai = new OpenAI({ apiKey });

    const bloomDefinition: Record<BloomKey, string> = {
      remember: "recall of facts and basic concepts (define, list, name)",
      understand: "explaining ideas or concepts (explain, summarize, classify)",
      apply: "using information in new situations (solve, demonstrate, use)",
      analyze: "drawing connections among ideas (compare, contrast, differentiate)",
      evaluate: "justifying a decision or judgment (critique, defend, justify)",
      create: "producing new or original work (design, construct, plan)",
    };
    const difficultyGuide = {
      easy: "straightforward, single-step; answerable by scanning definitions",
      medium: "requires connecting two concepts or a short chain of reasoning",
      hard: "multi-step reasoning, edge cases, or nuanced discrimination between close alternatives",
    };

    const typeInstruction =
      args.questionType === "mixed"
        ? `Vary the questionType across multiple_choice, true_false and short_answer (mostly multiple_choice).`
        : `Every question must have questionType exactly "${args.questionType}".`;

    const system = [
      "You are an expert exam author for an adaptive learning platform.",
      "You write exam questions classified by Bloom's Taxonomy.",
      "Respond with STRICT JSON only, no markdown fences.",
      'Shape: {"questions":[{"questionText":string,"questionType":"multiple_choice"|"true_false"|"short_answer","options":string[]|null,"correctAnswer":string,"explanation":string,"marks":number,"expectedTimeSec":number}]}',
      "Rules: MC needs 3-5 plausible options and correctAnswer must equal one option;",
      "TF options are [\"True\",\"False\"] with correctAnswer True or False;",
      "short_answer has options null and a single canonical short answer;",
      "explanation explains WHY the answer is right (one or two sentences).",
    ].join(" ");

    const user = [
      `Course/class topic: ${args.topic}`,
      `Generate exactly ${args.count} questions.`,
      `Bloom's level: ${args.bloomLevel} — ${bloomDefinition[args.bloomLevel]}.`,
      `Difficulty: ${args.difficulty} — ${difficultyGuide[args.difficulty]}.`,
      typeInstruction,
      `Each question is worth ${args.marks} mark(s).`,
      `expectedTimeSec: about ${args.expectedTimeSec} seconds per question (realistic time to answer at the requested difficulty).`,
      "Vary wording so questions do not repeat the same stem.",
    ].join("\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_completion_tokens: 300 * Math.max(1, args.count),
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("AI returned invalid JSON — try again");
    }
    const list =
      parsed && typeof parsed === "object" && "questions" in parsed
        ? (parsed as { questions: unknown }).questions
        : parsed;
    const drafts = normalizeDrafts(list, args.count);
    if (drafts.length === 0)
      throw new Error("AI returned no usable questions — try again");

    return { drafts };
  },
});
