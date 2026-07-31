import type { QuestionAnswer, QuestionRequest } from "./types";

function questionDirectoryQuery(repoPath: string): string {
  return `directory=${encodeURIComponent(repoPath)}`;
}

export async function postOpencodeQuestionReply(input: {
  baseUrl: string;
  repoPath: string;
  requestId: string;
  answers: QuestionAnswer[];
}): Promise<void> {
  const url = `${input.baseUrl}/question/${encodeURIComponent(input.requestId)}/reply?${questionDirectoryQuery(input.repoPath)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: input.answers })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export async function postOpencodeQuestionReject(input: {
  baseUrl: string;
  repoPath: string;
  requestId: string;
}): Promise<void> {
  const url = `${input.baseUrl}/question/${encodeURIComponent(input.requestId)}/reject?${questionDirectoryQuery(input.repoPath)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export async function fetchOpencodeQuestions(input: {
  baseUrl: string;
  repoPath: string;
  sessionId: string;
}): Promise<QuestionRequest[]> {
  let lastError = "";
  for (const path of ["/question", "/question/"]) {
    try {
      const response = await fetch(`${input.baseUrl}${path}?${questionDirectoryQuery(input.repoPath)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.trim()) throw new Error("empty response");
      const raw = JSON.parse(text);
      const rows = Array.isArray(raw) ? raw : [];
      return rows.filter((row: any) => String(row?.sessionID || "") === input.sessionId) as QuestionRequest[];
    } catch (error) {
      lastError = `${path}: ${String(error)}`;
    }
  }
  throw new Error(lastError);
}
