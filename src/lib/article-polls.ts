import { supabase } from "@/integrations/supabase/client";

export type ArticlePoll = {
  id: string;
  article_id: string | null;
  created_by: string;
  title: string | null;
  status: string;
  require_auth: boolean;
  native_league_id: string | null;
  created_at: string;
};

export type ArticlePollQuestion = {
  id: string;
  poll_id: string;
  sort_order: number;
  prompt: string;
};

export type ArticlePollOption = {
  id: string;
  question_id: string;
  sort_order: number;
  label: string;
};

export type ArticlePollVote = {
  question_id: string;
  user_id: string;
  option_id: string;
  created_at: string;
};

export type ArticlePollBundle = {
  poll: ArticlePoll;
  questions: Array<
    ArticlePollQuestion & {
      options: ArticlePollOption[];
    }
  >;
  /** option_id → vote count */
  tallies: Record<string, number>;
  /** question_id → option_id for the current user */
  myVotes: Record<string, string>;
};

export type CreatePollQuestionInput = {
  prompt: string;
  options: string[];
};

export type CreatePollInput = {
  createdBy: string;
  title?: string | null;
  requireAuth?: boolean;
  nativeLeagueId?: string | null;
  questions: CreatePollQuestionInput[];
};

const POLL_COLS =
  "id, article_id, created_by, title, status, require_auth, native_league_id, created_at";

/** HTML marker inserted into article body; hydrated by ArticleView. */
export function pollEmbedHtml(pollId: string, title?: string | null): string {
  const label = (title?.trim() || "Poll").replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c,
  );
  // Visible placeholder in the editor; ArticleView clears children before mounting React.
  return (
    `<div class="lo-poll" data-poll-id="${pollId}" contenteditable="false">` +
    `<p class="lo-poll__editor-label"><strong>${label}</strong> — opens in Preview / published article</p>` +
    `</div><p><br /></p>`
  );
}

export async function createArticlePoll(input: CreatePollInput): Promise<ArticlePoll> {
  const questions = input.questions
    .map((q) => ({
      prompt: q.prompt.trim(),
      options: q.options.map((o) => o.trim()).filter(Boolean),
    }))
    .filter((q) => q.prompt && q.options.length >= 2);

  if (questions.length < 1) throw new Error("Add at least one question with two answers.");
  if (questions.length > 10) throw new Error("At most 10 questions per poll.");
  for (const q of questions) {
    if (q.options.length > 8) throw new Error("At most 8 answer options per question.");
  }

  const leagueId = input.nativeLeagueId?.trim() || null;

  const { data: poll, error: pollError } = await supabase
    .from("article_polls")
    .insert({
      created_by: input.createdBy,
      title: input.title?.trim() || null,
      status: "open",
      require_auth: input.requireAuth !== false,
      native_league_id: leagueId,
    })
    .select(POLL_COLS)
    .single();
  if (pollError) throw new Error(pollError.message);

  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi]!;
    const { data: question, error: qError } = await supabase
      .from("article_poll_questions")
      .insert({
        poll_id: poll.id,
        sort_order: qi,
        prompt: q.prompt.slice(0, 500),
      })
      .select("id")
      .single();
    if (qError) throw new Error(qError.message);

    const optionRows = q.options.map((label, oi) => ({
      question_id: question.id,
      sort_order: oi,
      label: label.slice(0, 200),
    }));
    const { error: oError } = await supabase.from("article_poll_options").insert(optionRows);
    if (oError) throw new Error(oError.message);
  }

  return poll as ArticlePoll;
}

export async function fetchArticlePollBundle(
  pollId: string,
  userId: string | null,
): Promise<ArticlePollBundle | null> {
  const { data: poll, error: pollError } = await supabase
    .from("article_polls")
    .select(POLL_COLS)
    .eq("id", pollId)
    .maybeSingle();
  if (pollError) throw new Error(pollError.message);
  if (!poll) return null;

  const { data: questions, error: qError } = await supabase
    .from("article_poll_questions")
    .select("id, poll_id, sort_order, prompt")
    .eq("poll_id", pollId)
    .order("sort_order", { ascending: true });
  if (qError) throw new Error(qError.message);

  const questionIds = (questions ?? []).map((q) => q.id);
  if (questionIds.length === 0) {
    return {
      poll: poll as ArticlePoll,
      questions: [],
      tallies: {},
      myVotes: {},
    };
  }

  const { data: options, error: oError } = await supabase
    .from("article_poll_options")
    .select("id, question_id, sort_order, label")
    .in("question_id", questionIds)
    .order("sort_order", { ascending: true });
  if (oError) throw new Error(oError.message);

  const { data: votes, error: vError } = await supabase
    .from("article_poll_votes")
    .select("question_id, user_id, option_id, created_at")
    .in("question_id", questionIds);
  if (vError) throw new Error(vError.message);

  const tallies: Record<string, number> = {};
  const myVotes: Record<string, string> = {};
  for (const vote of votes ?? []) {
    tallies[vote.option_id] = (tallies[vote.option_id] ?? 0) + 1;
    if (userId && vote.user_id === userId) {
      myVotes[vote.question_id] = vote.option_id;
    }
  }

  const optionsByQuestion = new Map<string, ArticlePollOption[]>();
  for (const opt of (options ?? []) as ArticlePollOption[]) {
    const list = optionsByQuestion.get(opt.question_id) ?? [];
    list.push(opt);
    optionsByQuestion.set(opt.question_id, list);
  }

  return {
    poll: poll as ArticlePoll,
    questions: ((questions ?? []) as ArticlePollQuestion[]).map((q) => ({
      ...q,
      options: optionsByQuestion.get(q.id) ?? [],
    })),
    tallies,
    myVotes,
  };
}

export async function castArticlePollVote(input: {
  questionId: string;
  userId: string;
  optionId: string;
}): Promise<void> {
  const { error } = await supabase.from("article_poll_votes").upsert(
    {
      question_id: input.questionId,
      user_id: input.userId,
      option_id: input.optionId,
    },
    { onConflict: "question_id,user_id" },
  );
  if (error) throw new Error(error.message);
}

export async function setArticlePollStatus(
  pollId: string,
  status: "open" | "closed",
): Promise<void> {
  const { error } = await supabase.from("article_polls").update({ status }).eq("id", pollId);
  if (error) throw new Error(error.message);
}

export async function closeArticlePoll(pollId: string): Promise<void> {
  await setArticlePollStatus(pollId, "closed");
}

export async function reopenArticlePoll(pollId: string): Promise<void> {
  await setArticlePollStatus(pollId, "open");
}

/** True when the signed-in user is a member of the poll's native league (if locked). */
export async function userCanVoteInLeague(
  nativeLeagueId: string | null,
  userId: string | null,
): Promise<boolean> {
  if (!nativeLeagueId) return true;
  if (!userId) return false;
  const { data, error } = await supabase
    .from("native_league_links")
    .select("id")
    .eq("user_id", userId)
    .eq("native_league_id", nativeLeagueId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}
