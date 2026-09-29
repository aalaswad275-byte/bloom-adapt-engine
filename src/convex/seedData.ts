/**
 * Seed question bank — "Data Structures & Algorithms" (v1 model-testing bank).
 *
 * Every question carries exactly one primary Bloom level, 2PL parameters
 * (a = discrimination, b = difficulty), expected/allocated time, learning
 * outcome, correct answer, and explanation. Difficulty spans the theta scale
 * so the adaptive engine has a usable measurement ladder at every level.
 */

export interface SeedQuestion {
  questionText: string;
  questionType:
    | "multiple_choice"
    | "true_false"
    | "fill_in_blank"
    | "short_answer"
    | "code_output";
  bloomLevel:
    | "remember"
    | "understand"
    | "apply"
    | "analyze"
    | "evaluate"
    | "create";
  topic: string;
  learningOutcome: string;
  discriminationA: number;
  difficultyB: number;
  expectedTime: number; // seconds
  marks: number;
  correctAnswer: string;
  options?: string[] | null;
  explanation: string;
}

export const SEED_QUESTIONS: SeedQuestion[] = [
  // ---------------- REMEMBER (b: -2.2 .. -0.4) ----------------
  {
    questionText:
      "Which data structure organizes elements in First-In-First-Out (FIFO) order?",
    questionType: "multiple_choice",
    bloomLevel: "remember",
    topic: "Linear Structures",
    learningOutcome: "LO1.1 Identify core linear data structures",
    discriminationA: 1.1,
    difficultyB: -2.0,
    expectedTime: 30,
    marks: 1,
    correctAnswer: "Queue",
    options: ["Stack", "Queue", "Binary tree", "Hash map"],
    explanation:
      "A queue serves elements in the order they arrived (FIFO); a stack is LIFO.",
  },
  {
    questionText:
      "What is the average-case time complexity of a lookup in a balanced binary search tree with n nodes?",
    questionType: "multiple_choice",
    bloomLevel: "remember",
    topic: "Complexity Notation",
    learningOutcome: "LO1.2 Recall standard complexity classes",
    discriminationA: 1.0,
    difficultyB: -1.5,
    expectedTime: 25,
    marks: 1,
    correctAnswer: "O(log n)",
    options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
    explanation:
      "Each comparison halves the search space, giving logarithmic depth.",
  },
  {
    questionText:
      "Big-O notation describes the ___ bound of an algorithm's growth rate.",
    questionType: "fill_in_blank",
    bloomLevel: "remember",
    topic: "Complexity Notation",
    learningOutcome: "LO1.2 Recall standard complexity classes",
    discriminationA: 1.0,
    difficultyB: -1.2,
    expectedTime: 25,
    marks: 1,
    correctAnswer: "upper",
    explanation:
      "Big-O is an upper bound; Big-Omega is lower, Big-Theta is tight.",
  },
  {
    questionText: "A binary heap must always be a complete binary tree.",
    questionType: "true_false",
    bloomLevel: "remember",
    topic: "Heaps & Priority Queues",
    learningOutcome: "LO1.3 Recall heap structural invariants",
    discriminationA: 0.9,
    difficultyB: -0.9,
    expectedTime: 20,
    marks: 1,
    correctAnswer: "True",
    options: ["True", "False"],
    explanation:
      "Heaps are complete trees by definition; heap-order alone is not enough.",
  },
  {
    questionText:
      "Which traversal visits a binary tree's nodes in sorted order (for a BST)?",
    questionType: "multiple_choice",
    bloomLevel: "remember",
    topic: "Trees",
    learningOutcome: "LO1.4 Recall standard tree traversals",
    discriminationA: 1.0,
    difficultyB: -0.4,
    expectedTime: 25,
    marks: 1,
    correctAnswer: "In-order",
    options: ["Pre-order", "In-order", "Post-order", "Level-order"],
    explanation: "In-order traversal of a BST yields ascending sorted order.",
  },

  // ---------------- UNDERSTAND (b: -1.0 .. 0.2) ----------------
  {
    questionText:
      "Why does inserting into a hash table degrade from O(1) to O(n) in the worst case?",
    questionType: "short_answer",
    bloomLevel: "understand",
    topic: "Hashing",
    learningOutcome: "LO2.1 Explain hashing collision behavior",
    discriminationA: 1.2,
    difficultyB: -1.0,
    expectedTime: 60,
    marks: 2,
    correctAnswer: "collisions|all keys same slot|chains grow",
    explanation:
      "When many keys collide into one bucket, probing/chain length grows linearly with n.",
  },
  {
    questionText:
      "A stack processes elements in the same order as a queue.",
    questionType: "true_false",
    bloomLevel: "understand",
    topic: "Linear Structures",
    learningOutcome: "LO2.2 Contrast linear structure semantics",
    discriminationA: 1.0,
    difficultyB: -0.6,
    expectedTime: 25,
    marks: 1,
    correctAnswer: "False",
    options: ["True", "False"],
    explanation:
      "A stack reverses order (LIFO) while a queue preserves it (FIFO).",
  },
  {
    questionText:
      "Which statement best explains why quicksort's average complexity is O(n log n)?",
    questionType: "multiple_choice",
    bloomLevel: "understand",
    topic: "Sorting",
    learningOutcome: "LO2.3 Interpret divide-and-conquer recurrences",
    discriminationA: 1.3,
    difficultyB: -0.2,
    expectedTime: 55,
    marks: 2,
    correctAnswer:
      "Each partition halves the working array on average, and there are log n levels of halving",
    options: [
      "Because it uses recursion, which is always logarithmic",
      "Each partition halves the working array on average, and there are log n levels of halving",
      "Because the pivot is always the median element",
      "Because swaps are constant-time operations",
    ],
    explanation:
      "Average partitioning is balanced → recurrence T(n)=2T(n/2)+O(n) → O(n log n).",
  },
  {
    questionText:
      "Explain in one sentence what it means for a sort to be 'stable'.",
    questionType: "short_answer",
    bloomLevel: "understand",
    topic: "Sorting",
    learningOutcome: "LO2.4 Interpret stability of sorting algorithms",
    discriminationA: 1.1,
    difficultyB: 0.2,
    expectedTime: 45,
    marks: 2,
    correctAnswer:
      "equal elements keep|relative order preserved|equal keys retain order",
    explanation:
      "A stable sort preserves the relative order of records with equal keys.",
  },

  // ---------------- APPLY (b: 0.0 .. 1.2) ----------------
  {
    questionText:
      "Using the array [5, 2, 9, 1], apply two passes of selection sort. What is the array after the second pass?",
    questionType: "multiple_choice",
    bloomLevel: "apply",
    topic: "Sorting",
    learningOutcome: "LO3.1 Execute sorting algorithms by hand",
    discriminationA: 1.3,
    difficultyB: 0.0,
    expectedTime: 70,
    marks: 2,
    correctAnswer: "[1, 2, 9, 5]",
    options: ["[1, 2, 9, 5]", "[1, 2, 5, 9]", "[2, 5, 9, 1]", "[1, 5, 2, 9]"],
    explanation:
      "Pass 1 swaps 5↔1 → [1,2,9,5]; pass 2 selects 2 (already in place) → [1,2,9,5].",
  },
  {
    questionText:
      "Apply the hash function h(k) = k mod 7 to key 23. Which bucket does it land in?",
    questionType: "multiple_choice",
    bloomLevel: "apply",
    topic: "Hashing",
    learningOutcome: "LO3.2 Compute hash function outputs",
    discriminationA: 1.2,
    difficultyB: 0.1,
    expectedTime: 30,
    marks: 1,
    correctAnswer: "2",
    options: ["1", "2", "3", "6"],
    explanation: "23 mod 7 = 2 (23 = 3·7 + 2).",
  },
  {
    questionText:
      "What does this code print?\n\nlet s = [];\ns.push(1); s.push(2); s.push(3);\nconsole.log(s.pop() + s.pop());",
    questionType: "code_output",
    bloomLevel: "apply",
    topic: "Linear Structures",
    learningOutcome: "LO3.3 Trace stack operations in code",
    discriminationA: 1.4,
    difficultyB: 0.4,
    expectedTime: 50,
    marks: 2,
    correctAnswer: "5",
    explanation: "Pops return 3 then 2 → 3 + 2 = 5.",
  },
  {
    questionText:
      "A BST contains 8, 3, 10, 1, 6. Insert 7 by the standard BST insertion rule. What is 7's parent?",
    questionType: "multiple_choice",
    bloomLevel: "apply",
    topic: "Trees",
    learningOutcome: "LO3.4 Execute BST insertion",
    discriminationA: 1.3,
    difficultyB: 0.7,
    expectedTime: 60,
    marks: 2,
    correctAnswer: "6",
    options: ["3", "6", "8", "10"],
    explanation:
      "7 < 8 → left; 7 > 3 → right; 7 > 6 → right of 6. Parent = 6.",
  },
  {
    questionText:
      "Apply Dijkstra's algorithm on a graph. After extracting node u with dist(u)=4, an edge u→v of weight 3 gives dist(v)=8. What happens if v's current distance is 9?",
    questionType: "multiple_choice",
    bloomLevel: "apply",
    topic: "Graphs",
    learningOutcome: "LO3.5 Apply shortest-path relaxation",
    discriminationA: 1.5,
    difficultyB: 1.0,
    expectedTime: 75,
    marks: 3,
    correctAnswer: "v's distance is updated to 8",
    options: [
      "v's distance is updated to 8",
      "v's distance stays 9",
      "The algorithm terminates early",
      "u is re-inserted into the priority queue",
    ],
    explanation: "4 + 3 = 8 < 9, so relaxation improves v's distance to 8.",
  },
  {
    questionText:
      "How many comparisons does binary search need in the worst case for a sorted array of 16 elements?",
    questionType: "multiple_choice",
    bloomLevel: "apply",
    topic: "Searching",
    learningOutcome: "LO3.6 Apply complexity counting to concrete sizes",
    discriminationA: 1.2,
    difficultyB: 1.2,
    expectedTime: 45,
    marks: 2,
    correctAnswer: "5",
    options: ["3", "4", "5", "8"],
    explanation: "ceil(log2(17)) = 5 comparisons (halving 16 → 1).",
  },

  // ---------------- ANALYZE (b: 0.8 .. 1.8) ----------------
  {
    questionText:
      "Algorithm A: 100n operations. Algorithm B: n² operations. At what n do their costs cross?",
    questionType: "multiple_choice",
    bloomLevel: "analyze",
    topic: "Complexity Analysis",
    learningOutcome: "LO4.1 Differentiate growth-rate tradeoffs",
    discriminationA: 1.4,
    difficultyB: 0.8,
    expectedTime: 75,
    marks: 3,
    correctAnswer: "n = 100",
    options: ["n = 10", "n = 100", "n = 1000", "They never cross"],
    explanation: "100n = n² ⇒ n = 100 (for n > 0).",
  },
  {
    questionText:
      "A hash table with chaining shows constant-time lookups for random keys but O(n) for sorted sequential keys. What is the most plausible root cause?",
    questionType: "multiple_choice",
    bloomLevel: "analyze",
    topic: "Hashing",
    learningOutcome: "LO4.2 Diagnose structure-specific failure modes",
    discriminationA: 1.5,
    difficultyB: 1.0,
    expectedTime: 90,
    marks: 3,
    correctAnswer:
      "The hash function maps sequential keys to clustered buckets",
    options: [
      "The table's load factor is too low",
      "The hash function maps sequential keys to clustered buckets",
      "Chaining causes cache thrashing for all inputs",
      "Sequential keys are always harder to hash",
    ],
    explanation:
      "Structured inputs can collide systematically when the hash function doesn't decorrelate key patterns.",
  },
  {
    questionText:
      "Compare two sorting runs on nearly-sorted input: insertion sort finishes in O(n), merge sort in O(n log n). Which conclusion is supported?",
    questionType: "multiple_choice",
    bloomLevel: "analyze",
    topic: "Sorting",
    learningOutcome: "LO4.3 Analyze input-sensitivity of algorithms",
    discriminationA: 1.4,
    difficultyB: 1.2,
    expectedTime: 85,
    marks: 3,
    correctAnswer:
      "Insertion sort exploits existing order; its best case is linear",
    options: [
      "Merge sort is implemented incorrectly",
      "Insertion sort exploits existing order; its best case is linear",
      "Asymptotic analysis is invalid for nearly-sorted inputs",
      "Insertion sort is asymptotically faster than merge sort in general",
    ],
    explanation:
      "Nearly-sorted data minimizes inversions, insertion sort's cost driver.",
  },
  {
    questionText:
      "A priority queue is built with a sorted array (insert O(n), extract-min O(1)). Which workload suffers most versus a binary heap (insert O(log n), extract O(log n))?",
    questionType: "multiple_choice",
    bloomLevel: "analyze",
    topic: "Heaps & Priority Queues",
    learningOutcome: "LO4.4 Analyze data-structure workload fit",
    discriminationA: 1.5,
    difficultyB: 1.5,
    expectedTime: 90,
    marks: 3,
    correctAnswer: "Many interleaved inserts and extracts",
    options: [
      "Bulk-insert everything, then extract all",
      "Many interleaved inserts and extracts",
      "Only extract-min operations",
      "Workloads perform identically",
    ],
    explanation:
      "Interleaving repeatedly pays the O(n) insert cost; a heap amortizes both at O(log n).",
  },
  {
    questionText:
      "Trace: BFS from A in the graph A–B, A–C, B–D, C–D, D–E. Which node is dequeued third?",
    questionType: "multiple_choice",
    bloomLevel: "analyze",
    topic: "Graphs",
    learningOutcome: "LO4.5 Differentiate traversal orders",
    discriminationA: 1.4,
    difficultyB: 1.7,
    expectedTime: 80,
    marks: 2,
    correctAnswer: "C",
    options: ["B", "C", "D", "E"],
    explanation:
      "Queue evolution: [A] → [B,C] → [C,D] → [D,E]: C is dequeued third.",
  },
  {
    questionText:
      "Doubling n raises an algorithm's runtime from 8s to 65s. Which growth class is most consistent with this observation?",
    questionType: "multiple_choice",
    bloomLevel: "analyze",
    topic: "Complexity Analysis",
    learningOutcome: "LO4.1 Differentiate growth-rate tradeoffs",
    discriminationA: 1.4,
    difficultyB: 1.8,
    expectedTime: 85,
    marks: 3,
    correctAnswer: "Cubic, Θ(n³)",
    options: ["Linear, Θ(n)", "Quadratic, Θ(n²)", "Cubic, Θ(n³)", "Exponential, Θ(2ⁿ)"],
    explanation: "8 → 65 ≈ 8× = 2³ growth ⇒ cubic.",
  },

  // ---------------- EVALUATE (b: 1.4 .. 2.2) ----------------
  {
    questionText:
      "A team must store 10M lookups/second against a fixed key universe of 1M keys, with hard worst-case latency. Which structure best justifies its choice?",
    questionType: "multiple_choice",
    bloomLevel: "evaluate",
    topic: "Hashing",
    learningOutcome: "LO5.1 Justify structure choice under constraints",
    discriminationA: 1.6,
    difficultyB: 1.4,
    expectedTime: 100,
    marks: 3,
    correctAnswer:
      "Direct-address table: keys are enumerable and worst-case O(1) beats hashed fallbacks",
    options: [
      "Balanced BST: guaranteed O(log n) with less memory",
      "Direct-address table: keys are enumerable and worst-case O(1) beats hashed fallbacks",
      "Trie: memory is irrelevant at this scale",
      "Skip list: probabilistic bounds are acceptable for hard deadlines",
    ],
    explanation:
      "When the universe is small and known, direct addressing removes hashing's worst case entirely.",
  },
  {
    questionText:
      "A reviewer claims: 'Quicksort should always be rejected because its worst case is O(n²).' Evaluate this claim.",
    questionType: "multiple_choice",
    bloomLevel: "evaluate",
    topic: "Sorting",
    learningOutcome: "LO5.2 Critique reasoning about tradeoffs",
    discriminationA: 1.6,
    difficultyB: 1.7,
    expectedTime: 100,
    marks: 3,
    correctAnswer:
      "Flawed: randomized/median pivots make the worst case vanishingly unlikely in practice",
    options: [
      "Correct: worst-case bounds always dominate decisions",
      "Flawed: randomized/median pivots make the worst case vanishingly unlikely in practice",
      "Correct, because merge sort uses less memory",
      "Flawed, because O(n²) is still faster than O(n log n)",
    ],
    explanation:
      "Sound evaluation weighs probability of the worst case and constants, not just the bound.",
  },
  {
    questionText:
      "Judge which justification for choosing merge sort over quicksort for a linked list is strongest.",
    questionType: "multiple_choice",
    bloomLevel: "evaluate",
    topic: "Sorting",
    learningOutcome: "LO5.3 Judge design justifications",
    discriminationA: 1.5,
    difficultyB: 1.9,
    expectedTime: 95,
    marks: 3,
    correctAnswer:
      "Merge sort needs no random access and concatenates lists in O(1)",
    options: [
      "Merge sort is stable, which lists always require",
      "Merge sort needs no random access and concatenates lists in O(1)",
      "Quicksort cannot be implemented on linked lists",
      "Merge sort uses O(1) auxiliary memory on lists",
    ],
    explanation:
      "Linked lists suit merge sort: sequential access is natural and merging is pointer surgery.",
  },
  {
    questionText:
      "A critic says a Bloom-filter use (allowing false positives, no false negatives) is unacceptable for a cache-admission layer. Evaluate.",
    questionType: "multiple_choice",
    bloomLevel: "evaluate",
    topic: "Hashing",
    learningOutcome: "LO5.2 Critique reasoning about tradeoffs",
    discriminationA: 1.7,
    difficultyB: 2.1,
    expectedTime: 105,
    marks: 3,
    correctAnswer:
      "The criticism is weak: false positives only waste a cache slot, they never evict valid data",
    options: [
      "The criticism is valid: false positives break caches",
      "The criticism is weak: false positives only waste a cache slot, they never evict valid data",
      "Both are wrong: Bloom filters have false negatives",
      "It depends on the hash function only",
    ],
    explanation:
      "The failure mode's cost determines acceptability — here it is bounded and benign.",
  },
  {
    questionText:
      "Two teams propose implementations for an LRU cache. Team 1: array + timestamp scan. Team 2: hash map + doubly linked list. Which evaluation is defensible?",
    questionType: "multiple_choice",
    bloomLevel: "evaluate",
    topic: "Linear Structures",
    learningOutcome: "LO5.3 Judge design justifications",
    discriminationA: 1.6,
    difficultyB: 2.2,
    expectedTime: 110,
    marks: 4,
    correctAnswer:
      "Team 2: O(1) get/put justifies the extra pointers under latency requirements",
    options: [
      "Team 1: simpler code lowers total cost",
      "Team 2: O(1) get/put justifies the extra pointers under latency requirements",
      "Both are equivalent for large workloads",
      "Neither: LRU requires O(n) invalidation",
    ],
    explanation:
      "The canonical LRU structure achieves O(1) for both operations; the scan approach is O(n) per touch.",
  },

  // ---------------- CREATE (b: 1.8 .. 2.4) ----------------
  {
    questionText:
      "Design a structure supporting insert, delete, and median in O(log n). Which composition is the soundest starting point?",
    questionType: "multiple_choice",
    bloomLevel: "create",
    topic: "Heaps & Priority Queues",
    learningOutcome: "LO6.1 Compose structures for novel requirements",
    discriminationA: 1.7,
    difficultyB: 1.8,
    expectedTime: 120,
    marks: 4,
    correctAnswer:
      "Two heaps (max-heap lower half, min-heap upper half) rebalanced per operation",
    options: [
      "Two heaps (max-heap lower half, min-heap upper half) rebalanced per operation",
      "A single min-heap plus an array of medians",
      "A sorted array with binary insertion",
      "A hash map keyed by value ranks",
    ],
    explanation:
      "The dual-heap (median maintenance) pattern gives logarithmic everything with O(1) median read.",
  },
  {
    questionText:
      "Synthesize an algorithm: detect whether a directed graph has a cycle, in O(V+E), with justification. Which plan is correct?",
    questionType: "multiple_choice",
    bloomLevel: "create",
    topic: "Graphs",
    learningOutcome: "LO6.2 Construct algorithmic solutions with proof sketches",
    discriminationA: 1.7,
    difficultyB: 2.0,
    expectedTime: 130,
    marks: 4,
    correctAnswer:
      "DFS with three colors: a back edge to a gray node proves a cycle",
    options: [
      "BFS from every node, checking for repeats",
      "DFS with three colors: a back edge to a gray node proves a cycle",
      "Sort edges by weight and scan for duplicates",
      "Count nodes: if edges > nodes, there is a cycle",
    ],
    explanation:
      "White/gray/black DFS coloring detects back edges — the exact structural signature of a directed cycle.",
  },
  {
    questionText:
      "Propose the minimal modification that turns a standard BST into an order-statistic structure (select k-th smallest in O(log n)).",
    questionType: "multiple_choice",
    bloomLevel: "create",
    topic: "Trees",
    learningOutcome: "LO6.3 Extend known structures to new capabilities",
    discriminationA: 1.8,
    difficultyB: 2.2,
    expectedTime: 130,
    marks: 4,
    correctAnswer:
      "Augment each node with subtree size and use it to guide selection",
    options: [
      "Store all nodes in an auxiliary sorted array",
      "Augment each node with subtree size and use it to guide selection",
      "Rebalance the tree after every query",
      "Keep a counter of total nodes only",
    ],
    explanation:
      "Subtree-size augmentation enables order-statistic queries without changing asymptotics.",
  },
  {
    questionText:
      "A streaming app must report the top-k frequent elements with bounded memory. Design the pipeline: which composition is most defensible?",
    questionType: "multiple_choice",
    bloomLevel: "create",
    topic: "Hashing",
    learningOutcome: "LO6.1 Compose structures for novel requirements",
    discriminationA: 1.8,
    difficultyB: 2.4,
    expectedTime: 140,
    marks: 4,
    correctAnswer:
      "Count-Min sketch for counts + min-heap of size k for the leaders",
    options: [
      "Full histogram of all distinct items + sort per query",
      "Count-Min sketch for counts + min-heap of size k for the leaders",
      "Random sampling without counting",
      "A queue that evicts the oldest items",
    ],
    explanation:
      "Sketch + bounded heap is the canonical streaming top-k composition: sublinear memory, O(log k) updates.",
  },
];
