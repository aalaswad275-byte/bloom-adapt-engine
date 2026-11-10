/**
 * Question taxonomy — the administrator's view of the classification
 * vocabulary used by every question form and every filter.
 *
 * Categories (subjects) own topics (sub-categories) and share one list of
 * question types. Everything here is stored in the database, so edits take
 * effect immediately in the class Question Bank, the Shared Questions bank,
 * class creation and the reports — nothing is hardcoded in the client.
 *
 * Values in use cannot be deleted (the mutation explains why); archive them
 * instead so historical questions keep their label.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Archive,
  BookOpen,
  Check,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Tags,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AdminPageHeader,
  StatCard,
  StatusBadge,
  useConfirmAction,
} from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Topic = {
  id: string;
  name: string;
  status: "active" | "archived";
  sortOrder: number;
};

type Category = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  sortOrder: number;
  topics: Topic[];
};

type QuestionType = {
  id: string;
  key: string;
  label: string;
  answerFormat: "multiple_choice" | "true_false" | "text";
  status: "active" | "archived";
  sortOrder: number;
  isSystem: boolean;
};

const FORMAT_LABEL: Record<QuestionType["answerFormat"], string> = {
  multiple_choice: "Choice",
  true_false: "True / False",
  text: "Written answer",
};

export default function QuestionTaxonomy() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const taxonomy = useQuery(api.taxonomy.getTaxonomy, { includeArchived }) as
    | { categories: Category[]; types: QuestionType[]; canManage: boolean }
    | undefined;

  const createCategory = useMutation(api.taxonomy.createCategory);
  const updateCategory = useMutation(api.taxonomy.updateCategory);
  const deleteCategory = useMutation(api.taxonomy.deleteCategory);
  const createTopic = useMutation(api.taxonomy.createTopic);
  const updateTopic = useMutation(api.taxonomy.updateTopic);
  const deleteTopic = useMutation(api.taxonomy.deleteTopic);
  const createType = useMutation(api.taxonomy.createQuestionType);
  const updateType = useMutation(api.taxonomy.updateQuestionType);
  const deleteType = useMutation(api.taxonomy.deleteQuestionType);
  const seed = useMutation(api.taxonomy.seedDefaultTaxonomy);

  const { confirm, element } = useConfirmAction();

  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryEdit, setCategoryEdit] = useState<Category | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDesc, setCategoryDesc] = useState("");
  const [topicName, setTopicName] = useState("");
  const [typeOpen, setTypeOpen] = useState(false);
  const [typeEdit, setTypeEdit] = useState<QuestionType | null>(null);
  const [typeLabel, setTypeLabel] = useState("");
  const [typeFormat, setTypeFormat] =
    useState<QuestionType["answerFormat"]>("text");

  const categories = taxonomy?.categories ?? [];
  const types = taxonomy?.types ?? [];
  const activeCategory =
    categories.find((c) => c.id === activeCategoryId) ?? categories[0] ?? null;

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.success(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  };

  const openCategory = (category: Category | null) => {
    setCategoryEdit(category);
    setCategoryName(category?.name ?? "");
    setCategoryDesc(category?.description ?? "");
    setCategoryOpen(true);
  };

  const saveCategory = async () => {
    if (!categoryName.trim()) {
      toast.error("Category name is required");
      return;
    }
    if (categoryEdit) {
      await run(
        () =>
          updateCategory({
            id: categoryEdit.id as Id<"questionCategories">,
            name: categoryName.trim(),
            description: categoryDesc,
          }),
        "Category updated",
      );
    } else {
      await run(
        () =>
          createCategory({
            name: categoryName.trim(),
            description: categoryDesc || undefined,
          }),
        "Category added",
      );
    }
    setCategoryOpen(false);
  };

  const openType = (type: QuestionType | null) => {
    setTypeEdit(type);
    setTypeLabel(type?.label ?? "");
    setTypeFormat(type?.answerFormat ?? "text");
    setTypeOpen(true);
  };

  const saveType = async () => {
    if (!typeLabel.trim()) {
      toast.error("Type label is required");
      return;
    }
    if (typeEdit) {
      await run(
        () =>
          updateType({
            id: typeEdit.id as Id<"questionTypeDefs">,
            label: typeLabel.trim(),
            ...(typeEdit.isSystem ? {} : { answerFormat: typeFormat }),
          }),
        "Question type updated",
      );
    } else {
      await run(
        () =>
          createType({
            label: typeLabel.trim(),
            answerFormat: typeFormat,
          }),
        "Question type added",
      );
    }
    setTypeOpen(false);
  };

  return (
    <>
      {element}
      <AdminPageHeader
        title="Question taxonomy"
        subtitle="Subjects, topics and question types used across the question bank, shared bank and reports"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setIncludeArchived((v) => !v)}
            >
              {includeArchived ? "Hide archived" : "Show archived"}
            </Button>
            <Button className="clay-press rounded-full" onClick={() => openCategory(null)}>
              <Plus className="mr-1.5 size-4" /> Add category
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Categories"
          value={categories.filter((c) => c.status === "active").length}
          icon={<Layers className="size-4 text-primary" />}
        />
        <StatCard
          label="Topics"
          value={categories.reduce(
            (sum, c) => sum + c.topics.filter((t) => t.status === "active").length,
            0,
          )}
          icon={<Tags className="size-4 text-primary" />}
        />
        <StatCard
          label="Question types"
          value={types.filter((t) => t.status === "active").length}
          icon={<BookOpen className="size-4 text-primary" />}
        />
        <StatCard
          label="Archived"
          value={
            categories.filter((c) => c.status === "archived").length +
            types.filter((t) => t.status === "archived").length
          }
          icon={<Archive className="size-4 text-primary" />}
        />
      </div>

      {taxonomy === undefined ? (
        <div className="clay p-8 text-sm text-muted-foreground">Loading taxonomy…</div>
      ) : categories.length === 0 && types.length === 0 ? (
        <div className="clay p-8 text-center">
          <p className="font-bold">The taxonomy is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Install the starter subjects and question types, then adjust them to
            match your institution.
          </p>
          <Button
            className="mt-4 rounded-full"
            onClick={() => void run(() => seed({}), "Starter taxonomy installed")}
          >
            Install defaults
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          {/* Categories + topics */}
          <section className="clay p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold">Subjects &amp; categories</h2>
                <p className="text-xs text-muted-foreground">
                  Each subject owns its topics. Classes pick a subject, so this
                  list also controls Shared Question filtering.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => openCategory(null)}
              >
                <Plus className="mr-1 size-3.5" /> Add
              </Button>
            </div>

            <div className="mt-4 grid gap-2">
              {categories.map((category) => {
                const selected = activeCategory?.id === category.id;
                return (
                  <div
                    key={category.id}
                    className={cn(
                      "rounded-2xl border p-3 transition-colors",
                      selected ? "border-primary/40 bg-primary/5" : "border-border",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 text-left"
                        onClick={() => setActiveCategoryId(category.id)}
                      >
                        {selected ? (
                          <Check className="size-3.5 shrink-0 text-primary" />
                        ) : (
                          <span className="size-3.5 shrink-0" />
                        )}
                        <span className="truncate text-sm font-semibold">
                          {category.name}
                        </span>
                        <Badge className="clay-inset rounded-full text-[10px] text-muted-foreground">
                          {category.topics.length} topic
                          {category.topics.length === 1 ? "" : "s"}
                        </Badge>
                        {category.status !== "active" && <StatusBadge status="inactive" />}
                      </button>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-full"
                          onClick={() => openCategory(category)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-full"
                          title={
                            category.status === "active" ? "Archive" : "Restore"
                          }
                          onClick={() =>
                            void run(
                              () =>
                                updateCategory({
                                  id: category.id as Id<"questionCategories">,
                                  status:
                                    category.status === "active"
                                      ? "archived"
                                      : "active",
                                }),
                              category.status === "active"
                                ? "Category archived"
                                : "Category restored",
                            )
                          }
                        >
                          {category.status === "active" ? (
                            <Archive className="size-3.5" />
                          ) : (
                            <RotateCcw className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-full text-destructive hover:bg-destructive/10"
                          onClick={() =>
                            confirm({
                              title: `Delete "${category.name}"?`,
                              description:
                                "Only unused categories can be deleted. Archive it to keep historical questions valid.",
                              run: async () => {
                                await run(
                                  () =>
                                    deleteCategory({
                                      id: category.id as Id<"questionCategories">,
                                    }),
                                  "Category deleted",
                                );
                              },
                            })
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    {category.description && (
                      <p className="mt-1 pl-5 text-xs text-muted-foreground">
                        {category.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Topics of the selected category */}
          <section className="clay p-5">
            <h2 className="text-base font-extrabold">
              {activeCategory ? `Topics in ${activeCategory.name}` : "Topics"}
            </h2>
            <p className="text-xs text-muted-foreground">
              A topic narrows a question to a language, module or skill (C++,
              Algebra, Grammar…). Question forms offer only these values.
            </p>

            {activeCategory ? (
              <>
                <div className="mt-4 flex items-end gap-2">
                  <div className="flex-1">
                    <Label className="text-xs font-semibold">New topic</Label>
                    <Input
                      value={topicName}
                      onChange={(e) => setTopicName(e.target.value)}
                      placeholder="e.g. Python"
                      className="clay-inset mt-1.5 rounded-full px-4"
                    />
                  </div>
                  <Button
                    className="rounded-full"
                    disabled={!topicName.trim()}
                    onClick={() =>
                      void run(async () => {
                        await createTopic({
                          categoryId: activeCategory.id as Id<"questionCategories">,
                          name: topicName.trim(),
                        });
                        setTopicName("");
                      }, "Topic added")
                    }
                  >
                    <Plus className="mr-1 size-4" /> Add
                  </Button>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {activeCategory.topics.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No topics yet — add the first one above.
                    </p>
                  )}
                  {activeCategory.topics.map((topic) => (
                    <div
                      key={topic.id}
                      className="flex items-center justify-between gap-2 rounded-full border px-3 py-1.5"
                    >
                      <span
                        className={cn(
                          "truncate text-sm",
                          topic.status !== "active" && "text-muted-foreground line-through",
                        )}
                      >
                        {topic.name}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 rounded-full p-0"
                          title={topic.status === "active" ? "Archive" : "Restore"}
                          onClick={() =>
                            void run(
                              () =>
                                updateTopic({
                                  id: topic.id as Id<"questionTopics">,
                                  status:
                                    topic.status === "active" ? "archived" : "active",
                                }),
                              topic.status === "active"
                                ? "Topic archived"
                                : "Topic restored",
                            )
                          }
                        >
                          {topic.status === "active" ? (
                            <Archive className="size-3" />
                          ) : (
                            <RotateCcw className="size-3" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 rounded-full p-0 text-destructive hover:bg-destructive/10"
                          title="Delete topic"
                          onClick={() =>
                            confirm({
                              title: `Delete "${topic.name}"?`,
                              description:
                                "Topics used by questions cannot be deleted; archive them instead.",
                              run: async () => {
                                await run(
                                  () => deleteTopic({ id: topic.id as Id<"questionTopics"> }),
                                  "Topic deleted",
                                );
                              },
                            })
                          }
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">
                Add a category first.
              </p>
            )}
          </section>

          {/* Question types */}
          <section className="clay p-5 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold">Question types</h2>
                <p className="text-xs text-muted-foreground">
                  The pedagogical type instructors choose. The answer format is
                  what students see and how the answer is graded.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => openType(null)}
              >
                <Plus className="mr-1 size-3.5" /> Add type
              </Button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {types.map((type) => (
                <div
                  key={type.id}
                  className={cn(
                    "rounded-2xl border p-3",
                    type.status !== "active" && "opacity-70",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{type.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {FORMAT_LABEL[type.answerFormat]} ·{" "}
                        <code className="text-[10px]">{type.key}</code>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-7 rounded-full p-0"
                        onClick={() => openType(type)}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-7 rounded-full p-0"
                        title={type.status === "active" ? "Archive" : "Restore"}
                        onClick={() =>
                          void run(
                            () =>
                              updateType({
                                id: type.id as Id<"questionTypeDefs">,
                                status:
                                  type.status === "active" ? "archived" : "active",
                              }),
                            type.status === "active"
                              ? "Question type archived"
                              : "Question type restored",
                          )
                        }
                      >
                        {type.status === "active" ? (
                          <Archive className="size-3" />
                        ) : (
                          <RotateCcw className="size-3" />
                        )}
                      </Button>
                      {!type.isSystem && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 rounded-full p-0 text-destructive hover:bg-destructive/10"
                          onClick={() =>
                            confirm({
                              title: `Delete "${type.label}"?`,
                              description:
                                "Types used by questions cannot be deleted; archive them instead.",
                              run: async () => {
                                await run(
                                  () =>
                                    deleteType({
                                      id: type.id as Id<"questionTypeDefs">,
                                    }),
                                  "Question type deleted",
                                );
                              },
                            })
                          }
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {type.isSystem && (
                    <Badge className="mt-2 rounded-full bg-[var(--accent)] text-[10px] font-bold text-muted-foreground">
                      Built-in
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Category dialog */}
      <Dialog open={categoryOpen} onOpenChange={setCategoryOpen}>
        <DialogContent className="clay border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {categoryEdit ? "Edit category" : "Add category"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Name</Label>
              <Input
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="e.g. Mathematics"
                className="clay-inset rounded-full px-4"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Description (optional)</Label>
              <Input
                value={categoryDesc}
                onChange={(e) => setCategoryDesc(e.target.value)}
                placeholder="Shown to instructors in the filter list"
                className="clay-inset rounded-full px-4"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setCategoryOpen(false)}
            >
              Cancel
            </Button>
            <Button className="rounded-full" onClick={() => void saveCategory()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Type dialog */}
      <Dialog open={typeOpen} onOpenChange={setTypeOpen}>
        <DialogContent className="clay border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {typeEdit ? "Edit question type" : "Add question type"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Label</Label>
              <Input
                value={typeLabel}
                onChange={(e) => setTypeLabel(e.target.value)}
                placeholder="e.g. Case study"
                className="clay-inset rounded-full px-4"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Answer format</Label>
              <Select
                value={typeFormat}
                onValueChange={(value) =>
                  setTypeFormat(value as QuestionType["answerFormat"])
                }
                disabled={typeEdit?.isSystem === true}
              >
                <SelectTrigger className="clay-inset rounded-full px-4">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="multiple_choice">Multiple choice</SelectItem>
                  <SelectItem value="true_false">True / False</SelectItem>
                  <SelectItem value="text">Written answer</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Built-in types keep their format. Written answers are graded
                against the model answer, case-insensitively.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setTypeOpen(false)}
            >
              Cancel
            </Button>
            <Button className="rounded-full" onClick={() => void saveType()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
