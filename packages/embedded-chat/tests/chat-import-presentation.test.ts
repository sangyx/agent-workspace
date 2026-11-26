import { expect, it } from "vitest";
import {
  filterImportCandidates,
  importCandidateTitle,
  isApprovalReviewTitle,
} from "../src/chatImportPresentation";
const review =
  "The following is the Codex agent history whose request action you are assessing.";

it("bounds list titles while retaining ordinary text and classifying only exact review envelopes", () => {
  const raw = "实验 baseline 😀\n".repeat(10000);
  const title = importCandidateTitle(raw);
  expect(Array.from(title)).toHaveLength(180);
  expect(title.endsWith("…")).toBe(true);
  expect(title).not.toContain("\n");
  expect(importCandidateTitle("  A short\n title  ")).toBe("A short title");
  expect(importCandidateTitle(review + raw)).toBe("Codex approval review");
  expect(isApprovalReviewTitle("Explain this: " + review)).toBe(false);
  expect(raw).toContain("\n");
});
it("searches all candidates with case/width normalization, Chinese fragments and combined title/provider/date terms", () => {
  const candidates = Array.from({ length: 120 }, (_, i) => ({
    id: String(i),
    title: i === 119 ? "FTQ baseline 消融实验" : "Other " + i,
    provider: i === 119 ? "codex" : "claude",
    updatedAt: "2026-11-26T10:00:00Z",
  }));
  expect(
    filterImportCandidates(candidates, "  ＦＴＱ CODEX 2026-11  ").map(
      (c) => c.id,
    ),
  ).toEqual(["119"]);
  expect(filterImportCandidates(candidates, "消融").map((c) => c.id)).toEqual([
    "119",
  ]);
  expect(filterImportCandidates(candidates, "ftq claude")).toEqual([]);
  expect(filterImportCandidates(candidates, "  ")).toBe(candidates);
});
