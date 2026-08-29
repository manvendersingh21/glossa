import { describe, expect, it } from "vitest";
import reviewedCard from "../../data/reference/sfmta-5th-mission-reviewed.json";
import {
  documentToTimingEstimate,
  parseSfmtaTimingDocument,
} from "./sfmta-timing-parser";

describe("SFMTA reviewed timing-card parser", () => {
  it("parses the reviewed 5th/Mission fixture without OCR", () => {
    const card = parseSfmtaTimingDocument(reviewedCard);
    expect(card.intersection.cnn).toBe("24634000");
    expect(card.plans).toHaveLength(3);
    expect(card.plans[0].cycleSeconds).toBe(90);
    expect(card.plans[0].offsetSeconds).toBe(71);
    expect(card.provenance.extractionMethod).toBe("manual_review");
  });

  it("preserves evidence kind and stale-data status", () => {
    const card = parseSfmtaTimingDocument(reviewedCard);
    expect(card.evidenceKind).toBe("official");
    expect(card.provenance.sourceAsOf).toBe("2022-10-20");
    expect(card.provenance.staleAfter).toBe("2023-10-20");
  });

  it("requires staleAfter for official evidence", () => {
    expect(() => parseSfmtaTimingDocument({
      ...reviewedCard,
      provenance: { ...reviewedCard.provenance, staleAfter: undefined },
    })).toThrow(/staleAfter/);
  });

  it("rejects an unsupported evidence kind", () => {
    expect(() => parseSfmtaTimingDocument({ ...reviewedCard, evidenceKind: "guessed" }))
      .toThrow(/evidenceKind/);
  });

  it("requires modelVersion for modeled evidence and forbids it otherwise", () => {
    expect(() => parseSfmtaTimingDocument({ ...reviewedCard, evidenceKind: "modeled" }))
      .toThrow(/modelVersion.*required for modeled/);
    expect(() => parseSfmtaTimingDocument({ ...reviewedCard, modelVersion: "v1" }))
      .toThrow(/modelVersion.*only valid for modeled/);
  });

  it("accepts modeled evidence with a model version", () => {
    const card = parseSfmtaTimingDocument({ ...reviewedCard, evidenceKind: "modeled", modelVersion: "downtown-v1" });
    expect(card.evidenceKind).toBe("modeled");
    expect(card.modelVersion).toBe("downtown-v1");
  });

  it("represents phase intervals and actuation rules", () => {
    const card = parseSfmtaTimingDocument({
      ...reviewedCard,
      plans: [{
        ...reviewedCard.plans[0],
        phaseSequence: [2],
        phaseIntervals: [{
          phase: 2, movement: "northbound through", greenStartSeconds: 10, greenEndSeconds: 45,
          yellowSeconds: 3, allRedSeconds: 1, recall: "minimum", minimumGreenSeconds: 10,
        }],
        actuation: { mode: "semi_actuated", vehicleDetection: true, pedestrianDetection: true, vehicleExtensionSeconds: 3 },
      }],
    });
    expect(card.plans[0].phaseIntervals[0].greenEndSeconds).toBe(45);
    expect(card.plans[0].actuation?.mode).toBe("semi_actuated");
  });

  it("projects a reviewed document into a timing_estimates evidence row", () => {
    const row = documentToTimingEstimate(parseSfmtaTimingDocument(reviewedCard));
    expect(row.importKey).toBe("sfmta-5th-mission-reviewed-2022");
    expect(row.cnn).toBe("24634000");
    expect(row.evidenceKind).toBe("official");
    // All three plans share the 90-second cycle -> nominal, no range.
    expect(row.cycleNominalSeconds).toBe(90);
    expect(row.cycleMinSeconds).toBeNull();
    expect(row.cycleMaxSeconds).toBeNull();
    expect(row.confidence).toBe("medium");
    expect(row.modelVersion).toBeNull();
    expect(row.rationale.length).toBeGreaterThan(0);
    expect(row.rationale.some((note) => note.includes("time-of-day plan"))).toBe(true);
  });

  it("reports a cycle range across plans when plans differ", () => {
    const card = parseSfmtaTimingDocument({
      ...reviewedCard,
      plans: [
        { ...reviewedCard.plans[0], cycleSeconds: 80, offsetSeconds: 45 },
        { ...reviewedCard.plans[1], cycleSeconds: 106, offsetSeconds: 63 },
      ],
    });
    const row = documentToTimingEstimate(card);
    expect(row.cycleNominalSeconds).toBeNull();
    expect([row.cycleMinSeconds, row.cycleMaxSeconds]).toEqual([80, 106]);
  });

  it("derives confidence and model version from evidence kind", () => {
    const modeled = parseSfmtaTimingDocument({
      ...reviewedCard,
      evidenceKind: "modeled",
      modelVersion: "downtown-v1",
    });
    const row = documentToTimingEstimate(modeled);
    expect(row.confidence).toBe("low");
    expect(row.modelVersion).toBe("downtown-v1");
  });

  it("rejects an offset outside the cycle", () => {
    expect(() => parseSfmtaTimingDocument({
      ...reviewedCard,
      plans: [{ ...reviewedCard.plans[0], offsetSeconds: 90 }],
    })).toThrow(/offsetSeconds.*less than cycleSeconds/);
  });

  it("rejects invalid phase intervals and provenance", () => {
    expect(() => parseSfmtaTimingDocument({
      ...reviewedCard,
      provenance: { ...reviewedCard.provenance, pageNumbers: [] },
    })).toThrow(/pageNumbers.*at least one page/);
    expect(() => parseSfmtaTimingDocument({
      ...reviewedCard,
      plans: [{
        ...reviewedCard.plans[0], phaseSequence: [2], phaseIntervals: [{
          phase: 2, movement: "through", greenStartSeconds: 80, greenEndSeconds: 91,
        }],
      }],
    })).toThrow(/green interval/);
  });
});
