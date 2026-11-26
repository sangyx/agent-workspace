const reviewPrefix =
  "The following is the Codex agent history whose request action you are assessing.";

export function isApprovalReviewTitle(title: string | undefined) {
  return !!title?.trimStart().startsWith(reviewPrefix);
}

// A list label is a short description, never an entire prompt/transcript.
export function importCandidateTitle(title: string | undefined) {
  if (isApprovalReviewTitle(title)) return "Codex approval review";
  const compact = (title || "").replace(/\s+/gu, " ").trim();
  const chars = Array.from(compact.slice(0, 362));
  return chars.length > 180 ? chars.slice(0, 179).join("") + "…" : compact;
}

export function filterImportCandidates<T extends { title: string; provider: string; updatedAt?: string; cwd?: string; host?: string }>(
  candidates: T[],
  query: string,
) {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
  const terms = normalize(query).trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return candidates;
  return candidates.filter((candidate) => {
    const haystack = normalize(
      [candidate.title, candidate.provider, candidate.updatedAt, candidate.cwd, candidate.host].join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
}
