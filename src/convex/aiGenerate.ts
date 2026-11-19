/**
 * Gemini-powered question generation for the class Question Bank.
 *
 * The API key is read only inside this Node action from
 * `process.env.GEMINI_API_KEY`. It is never returned to the client, embedded
 * in a draft, or written to an audit record.
 *
 * Drafts are generated only. Persistence always goes through the existing
 * ownership-checked createQuestion / createSharedQuestion mutations.
 */

"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
  formatDragDropAnswer,
  normalizeDragDropConfig,
  type DragDropPlacement,
  type DragDropTarget,
} from "../lib/dragDrop";

const BLOOM = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;
type BloomKey = (typeof BLOOM)[number];

const REQUEST_TYPES = [
  "multiple_choice",
  "true_false",
  "short_answer",
  "math_problem",
  "programming",
  "drag_drop",
  "mixed",
] as const;
type RequestedType = (typeof REQUEST_TYPES)[number];

type CanonicalType =
  | "multiple_choice"
  | "true_false"
  | "short_answer"
  | "drag_drop";

type DraftQuestion = {
  questionText: string;
  questionType: CanonicalType;
  /** Taxonomy key, e.g. math_problem or programming. */
  typeKey: string;
  options: string[] | null;
  correctAnswer: string;
  dragDropTargets: DragDropTarget[] | null;
  dragDropCorrect: DragDropPlacement[] | null;
  partialCredit: boolean | null;
  explanation: string;
  marks: number;
  expectedTimeSec: number;
  difficultyB: number;
};

const MAX_QUESTIONS_PER_REQUEST = 10;
const MAX_GEMINI_ATTEMPTS = 3;
const DEFAULT_GEMINI_TIMEOUT_MS = 60_000;

const DIFFICULTY_GUIDE: Record<string, string> = {
  easy: "straightforward and single-step; answerable from definitions",
  medium: "connects two concepts or needs a short chain of reasoning",
  hard: "multi-step reasoning, edge cases, or close discriminating alternatives",
  expert:
    "advanced synthesis, abstract transfer, or multi-constraint problems requiring expert judgment",
};

const DIFFICULTY_B: Record<string, number> = {
  easy: -0.8,
  medium: 0,
  hard: 0.8,
  expert: 1.8,
};

const BLOOM_DEFINITION: Record<BloomKey, string> = {
  remember: "recall facts and basic concepts (define, list, name)",
  understand: "explain ideas or concepts (explain, summarize, classify)",
  apply: "use information in new situations (solve, demonstrate, use)",
  analyze: "draw connections among ideas (compare, contrast, differentiate)",
  evaluate: "justify a decision or judgment (critique, defend, justify)",
  create: "produce new or original work (design, construct, plan)",
};

function clampInt(
  value: unknown,
  low: number,
  high: number,
  fallback: number,
): number {
  const number =
    typeof value === "number" ? Math.round(value) : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(high, Math.max(low, number));
}

function text(value: unknown, max = 1_000): string {
  return String(value ?? "").trim().slice(0, max);
}

function stringList(value: unknown, maxItems = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, 300))
    .filter(Boolean)
    .slice(0, maxItems);
}

function requestedKind(type: RequestedType, rawTypeKey: string): string {
  if (type !== "mixed") return type;
  if (rawTypeKey === "math_problem" || rawTypeKey === "mathematical") {
    return "math_problem";
  }
  if (rawTypeKey === "programming" || rawTypeKey === "code") {
    return "programming";
  }
  if (rawTypeKey === "drag_drop") return "drag_drop";
  if (rawTypeKey === "true_false") return "true_false";
  if (rawTypeKey === "short_answer") return "short_answer";
  return "multiple_choice";
}

function normalizeDraft(
  item: unknown,
  requested: RequestedType,
  requestedMarks: number,
  requestedTimeSec: number,
  difficultyB: number,
): DraftQuestion | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const raw = item as Record<string, unknown>;
  const questionText = text(raw.questionText ?? raw.question, 500);
  if (!questionText) return null;

  const rawTypeKey = text(raw.typeKey ?? raw.type, 80).toLowerCase();
  const kind = requestedKind(requested, rawTypeKey);
  const explanation = text(raw.explanation, 800);
  const marks = clampInt(raw.marks, 1, 100, requestedMarks);
  const expectedTimeSec = clampInt(
    raw.expectedTimeSec,
    10,
    7_200,
    requestedTimeSec,
  );

  if (kind === "multiple_choice") {
    const options = stringList(raw.options, 6);
    if (options.length < 2) return null;
    const wanted = text(raw.correctAnswer ?? raw.correct_answer, 300);
    const correct =
      options.find((option) => option === wanted) ??
      options.find(
        (option) => option.toLowerCase() === wanted.toLowerCase(),
      );
    if (!correct) return null;
    return {
      questionText,
      questionType: "multiple_choice",
      typeKey: "multiple_choice",
      options,
      correctAnswer: correct,
      dragDropTargets: null,
      dragDropCorrect: null,
      partialCredit: null,
      explanation,
      marks,
      expectedTimeSec,
      difficultyB,
    };
  }

  if (kind === "true_false") {
    const rawAnswer = text(
      raw.correctAnswer ?? raw.correct_answer,
      20,
    ).toLowerCase();
    const correct = rawAnswer.startsWith("t") ? "True" : "False";
    return {
      questionText,
      questionType: "true_false",
      typeKey: "true_false",
      options: ["True", "False"],
      correctAnswer: correct,
      dragDropTargets: null,
      dragDropCorrect: null,
      partialCredit: null,
      explanation,
      marks,
      expectedTimeSec,
      difficultyB,
    };
  }

  if (kind === "drag_drop") {
    const items = stringList(raw.options ?? raw.dragDropItems ?? raw.items, 12);
    const rawTargets = Array.isArray(raw.dragDropTargets ?? raw.targets)
      ? (raw.dragDropTargets ?? raw.targets) as unknown[]
      : [];
    const targets: DragDropTarget[] = [];
    for (const entry of rawTargets.slice(0, 10)) {
      if (!entry || typeof entry !== "object") continue;
      const target = entry as Record<string, unknown>;
      const id = text(target.id, 80);
      const label = text(target.label ?? target.name, 200);
      if (!id || !label) continue;
      targets.push({
        id,
        label,
        hint: text(target.hint, 200) || undefined,
      });
    }
    const rawPlacements = Array.isArray(
      raw.dragDropCorrect ?? raw.correctPlacements ?? raw.placements,
    )
      ? (raw.dragDropCorrect ?? raw.correctPlacements ?? raw.placements) as unknown[]
      : [];
    const correct: DragDropPlacement[] = [];
    for (const entry of rawPlacements.slice(0, 20)) {
      if (!entry || typeof entry !== "object") continue;
      const placement = entry as Record<string, unknown>;
      const itemName = text(placement.item ?? placement.value, 300);
      const targetId = text(placement.targetId ?? placement.target, 80);
      if (itemName && targetId) correct.push({ item: itemName, targetId });
    }
    try {
      const config = normalizeDragDropConfig({
        items,
        targets,
        correct,
        partialCredit: true,
      });
      return {
        questionText,
        questionType: "drag_drop",
        typeKey: "drag_drop",
        options: config.items,
        correctAnswer: formatDragDropAnswer(config),
        dragDropTargets: config.targets,
        dragDropCorrect: config.correct,
        partialCredit: config.partialCredit,
        explanation,
        marks,
        expectedTimeSec,
        difficultyB,
      };
    } catch {
      return null;
    }
  }

  // Mathematical, programming, and free-text questions all use the text
  // answer format; typeKey preserves the authoring category.
  const correctAnswer = text(
    raw.correctAnswer ?? raw.correct_answer ?? raw.solution,
    2_000,
  );
  if (!correctAnswer) return null;
  const typeKey =
    kind === "math_problem"
      ? "math_problem"
      : kind === "programming"
        ? "programming"
        : "short_answer";
  return {
    questionText,
    questionType: "short_answer",
    typeKey,
    options: null,
    correctAnswer,
    dragDropTargets: null,
    dragDropCorrect: null,
    partialCredit: null,
    explanation,
    marks,
    expectedTimeSec,
    difficultyB,
  };
}

function normalizeDrafts(
  raw: unknown,
  requested: RequestedType,
  count: number,
  marks: number,
  expectedTimeSec: number,
  difficultyB: number,
): DraftQuestion[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { questions?: unknown }).questions)
      ? (raw as { questions: unknown[] }).questions
      : [];
  const drafts: DraftQuestion[] = [];
  for (const item of list) {
    const draft = normalizeDraft(item, requested, marks, expectedTimeSec, difficultyB);
    if (draft) drafts.push(draft);
    if (drafts.length >= count) break;
  }
  return drafts;
}

type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

class GeminiRequestError extends Error {
  status: number | null;
  retryable: boolean;
  authError: boolean;
  modelUnavailable: boolean;
  retryAfterMs: number;

  constructor(options: {
    message: string;
    status?: number | null;
    retryable: boolean;
    authError?: boolean;
    modelUnavailable?: boolean;
    retryAfterMs?: number;
  }) {
    super(options.message);
    this.name = "GeminiRequestError";
    this.status = options.status ?? null;
    this.retryable = options.retryable;
    this.authError = options.authError ?? false;
    this.modelUnavailable = options.modelUnavailable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? 0;
  }
}

function configInt(name: string, fallback: number, low: number, high: number) {
  return clampInt(process.env[name], low, high, fallback);
}

function safeModelName(value: string | undefined, fallback: string): string {
  return (value || fallback).trim().replace(/[^a-zA-Z0-9._-]/g, "") || fallback;
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after");
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(30_000, seconds * 1_000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(30_000, Math.max(0, date - Date.now())) : 0;
}

async function requestGemini(
  model: string,
  apiKey: string,
  body: string,
): Promise<GeminiPayload> {
  const controller = new AbortController();
  const timeoutMs = configInt(
    "GEMINI_TIMEOUT_MS",
    DEFAULT_GEMINI_TIMEOUT_MS,
    5_000,
    180_000,
  );
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body,
        signal: controller.signal,
      },
    );

    let payload: GeminiPayload = {};
    try {
      payload = (await response.json()) as GeminiPayload;
    } catch {
      // Keep the HTTP status as the source of truth if the body is not JSON.
    }

    if (!response.ok || payload.error) {
      const message = payload.error?.message ?? `Gemini HTTP ${response.status}`;
      const modelUnavailable =
        response.status === 404 ||
        /no longer available|not found|does not exist|not supported/i.test(message);
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        (response.status >= 500 && response.status <= 504) ||
        /high demand|temporar|overload|rate limit|try again/i.test(message);
      throw new GeminiRequestError({
        message,
        status: response.status,
        retryable,
        authError: response.status === 401 || response.status === 403,
        modelUnavailable,
        retryAfterMs: retryAfterMs(response),
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof GeminiRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiRequestError({
        message: `Gemini exceeded the ${timeoutMs}ms timeout`,
        retryable: true,
      });
    }
    throw new GeminiRequestError({
      message: "Gemini network request failed",
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

function friendlyGeminiFailure(
  error: GeminiRequestError | null,
  attempts: number,
): string {
  if (error?.authError) {
    return "Gemini authentication failed. Ask an administrator to verify the GEMINI_API_KEY setting.";
  }
  if (error?.modelUnavailable) {
    return "The selected Gemini model is unavailable, and the fallback model could not be reached. Please try again later.";
  }
  if (error?.status === 400) {
    return "Gemini rejected this generation request. Check the subject, topic, and question settings, then try again.";
  }
  return `Gemini is temporarily busy or unavailable. We tried ${attempts} time${
    attempts === 1 ? "" : "s"
  }, including a fallback model. Please wait a minute and try again.`;
}

/** Generate drafts. Requires GEMINI_API_KEY in the backend environment. */
export const generateQuestions = action({
  args: {
    classId: v.id("classes"),
    subject: v.string(),
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
      v.literal("math_problem"),
      v.literal("programming"),
      v.literal("drag_drop"),
      v.literal("mixed"),
    ),
    difficulty: v.union(
      v.literal("easy"),
      v.literal("medium"),
      v.literal("hard"),
      v.literal("expert"),
    ),
    marks: v.number(),
    expectedTimeSec: v.number(),
  },
  handler: async (ctx, args) => {
    const classContext = await ctx.runQuery(
      api.instructorAssessments.getClassContext,
      { classId: args.classId },
    );
    const topic = args.topic.trim().slice(0, 300);
    if (!topic) throw new Error("Enter a topic to generate from.");
    const subject = args.subject.trim().slice(0, 120) || classContext.className;
    const count = clampInt(args.count, 1, MAX_QUESTIONS_PER_REQUEST, 5);
    const marks = clampInt(args.marks, 1, 100, 1);
    const expectedTimeSec = clampInt(args.expectedTimeSec, 10, 7_200, 60);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured — add it in the Keys/API keys tab.",
      );
    }
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Instructor sign-in required.");
    const dayKey = new Date().toISOString().slice(0, 10);
    await ctx.runMutation(internal.aiQuota.claimQuota, {
      ownerKey: identity.subject,
      dayKey,
      count,
    });

    const typeInstructions: Record<RequestedType, string> = {
      multiple_choice:
        'Every item must use questionType "multiple_choice" and typeKey "multiple_choice", with 3–5 plausible options; correctAnswer must exactly equal one option.',
      true_false:
        'Every item must use questionType "true_false" and typeKey "true_false"; options must be ["True","False"] and correctAnswer "True" or "False".',
      short_answer:
        'Every item must use questionType "short_answer" and typeKey "short_answer"; options null; provide one concise canonical answer.',
      math_problem:
        'Every item must use questionType "short_answer" and typeKey "math_problem"; options null; provide the exact final answer plus enough explanation to show the solution steps.',
      programming:
        'Every item must use questionType "short_answer" and typeKey "programming"; options null; correctAnswer is a correct, self-contained solution/snippet, and explanation covers approach and complexity.',
      drag_drop:
        'Every item must use questionType "drag_drop" and typeKey "drag_drop"; options are draggable items, dragDropTargets are 2–6 drop zones with unique ids, and dragDropCorrect maps every item to exactly one target.',
      mixed:
        'Vary the items across multiple_choice, true_false, short_answer, math_problem, programming, and drag_drop. Each item carries its own matching questionType/typeKey and the shape that type requires.',
    };

    const system = [
      "You are an expert exam author for an adaptive learning platform.",
      "Write accurate, original questions aligned to Bloom's Taxonomy.",
      "Respond with strict JSON only, no markdown fences or commentary.",
      'Top-level shape: {"questions":[{...}]}.',
      "Every item requires: questionText, questionType, typeKey, options, correctAnswer, explanation, marks, expectedTimeSec.",
      "Drag-and-drop items additionally require dragDropTargets and dragDropCorrect; every draggable item must be assigned exactly once.",
      "Do not include answers in the question stem. Explanations must justify the answer.",
      `Generate exactly ${count} distinct questions unless the subject makes that impossible.`,
    ].join(" ");

    const user = [
      `Subject: ${subject}`,
      `Topic: ${topic}`,
      `Bloom's level: ${args.bloomLevel} — ${BLOOM_DEFINITION[args.bloomLevel]}.`,
      `Difficulty: ${args.difficulty} — ${DIFFICULTY_GUIDE[args.difficulty]}.`,
      typeInstructions[args.questionType],
      `Target marks per question: ${marks}. You may vary marks only when the question genuinely needs it.`,
      `Expected answer time: about ${expectedTimeSec} seconds per question.`,
      "Avoid duplicate stems and avoid questions answerable from the stem alone.",
    ].join("\n");

    const primaryModel = safeModelName(
      process.env.GEMINI_MODEL,
      "gemini-3.5-flash-lite",
    );
    const fallbackModel = safeModelName(
      process.env.GEMINI_FALLBACK_MODEL,
      "gemini-3.1-flash-lite",
    );
    const requestBody = JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.75,
        topP: 0.95,
        responseMimeType: "application/json",
        maxOutputTokens: Math.min(8_192, 900 * count + 800),
      },
    });

    let model = primaryModel;
    let payload: GeminiPayload | null = null;
    let lastError: GeminiRequestError | null = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= MAX_GEMINI_ATTEMPTS; attempt++) {
      attempts = attempt;
      try {
        payload = await requestGemini(model, apiKey, requestBody);
        break;
      } catch (error) {
        lastError =
          error instanceof GeminiRequestError
            ? error
            : new GeminiRequestError({
                message: "Unknown Gemini request failure",
                retryable: false,
              });
        // Technical diagnostics only: never include the API key, headers, or
        // the generation prompt in backend logs.
        console.error(
          `[gemini] generation attempt ${attempt}/${MAX_GEMINI_ATTEMPTS} failed`,
          {
            model,
            status: lastError.status,
            message: lastError.message.slice(0, 300),
            retryable: lastError.retryable,
            authError: lastError.authError,
            modelUnavailable: lastError.modelUnavailable,
          },
        );

        if (lastError.authError || attempt >= MAX_GEMINI_ATTEMPTS) break;
        const canFallback = fallbackModel !== model;
        if (lastError.modelUnavailable && canFallback) {
          model = fallbackModel;
          continue;
        }
        if (!lastError.retryable) break;

        const backoffMs = 1_000 * 2 ** (attempt - 1);
        const delay = Math.max(backoffMs, lastError.retryAfterMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
        // The final attempt uses the configured fallback model when possible.
        if (attempt === MAX_GEMINI_ATTEMPTS - 1 && canFallback) {
          model = fallbackModel;
        }
      }
    }

    if (!payload) {
      await ctx.runMutation(internal.aiQuota.refundQuota, {
        ownerKey: identity.subject,
        dayKey,
        count,
      });
      throw new Error(friendlyGeminiFailure(lastError, attempts));
    }

    if (payload.promptFeedback?.blockReason) {
      throw new Error(
        `Gemini blocked this prompt (${payload.promptFeedback.blockReason}). Rephrase the subject or topic.`,
      );
    }
    const candidate = payload.candidates?.[0];
    if (candidate?.finishReason === "SAFETY") {
      throw new Error(
        "Gemini stopped for safety reasons. Rephrase the subject or topic.",
      );
    }
    const content = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!content) throw new Error("Gemini returned an empty response — try again.");

    let parsed: unknown;
    try {
      const clean = content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```$/i, "")
        .trim();
      const start = clean.indexOf("{");
      const end = clean.lastIndexOf("}");
      parsed = JSON.parse(start >= 0 && end > start ? clean.slice(start, end + 1) : clean);
    } catch {
      throw new Error("Gemini returned invalid JSON — try again.");
    }

    const drafts = normalizeDrafts(
      parsed,
      args.questionType,
      count,
      marks,
      expectedTimeSec,
      DIFFICULTY_B[args.difficulty],
    );
    if (drafts.length === 0) {
      throw new Error(
        "Gemini returned no valid questions for this type — try again or switch question type.",
      );
    }
    return { drafts };
  },
});
