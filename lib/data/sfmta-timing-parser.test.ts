import { describe, expect, it } from "vitest";
import reviewedCard from "../../data/reference/sfmta-5th-mission-reviewed.json";
import { parseSfmtaTimingDocument } from "./sfmta-timing-parser";

describe("SFMTA reviewed timing-card parser", () => {
  it("parses the reviewed 5th/Mission fixture without OCR", () => {
    const card = parseSfmtaTimingDocument(reviewedCard);
    expect(card.intersection.cnn).toBe("24634000");
    expect(card.plans).toHaveLength(3);
    expect(card.plans[0].cycleSeconds).toBe(90);
    expect(card.plans[0].offsetSeconds).toBe(71);
    expect(card.provenance.extractionMethod).toBe("manual_review");
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

