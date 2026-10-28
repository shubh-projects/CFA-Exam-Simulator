import { describe, expect, it } from "vitest";
import { classifyQuestion, LEARNING_MODULES, CFA_TOPICS } from "../pipeline/topics";

describe("topic classifier (built from the Juice notes)", () => {
  it("knows all ten subjects and their learning modules", () => {
    for (const t of CFA_TOPICS) expect(LEARNING_MODULES[t]?.length ?? 0).toBeGreaterThan(3);
  });
  it("assigns subject and module", () => {
    expect(classifyQuestion("The goal of ordinary least squares regression is to minimize the sum of the squared deviations between the observations of the dependent variable").subtopic).toBe("Simple Linear Regression");
    expect(classifyQuestion("According to the GIPS standards, compliance may be claimed only if the firm").topic).toBe("Ethical and Professional Standards");
    expect(classifyQuestion("A policy rate that is neutral will become contractionary if trend growth").subtopic).toBe("Monetary Policy");
    expect(classifyQuestion("In the binomial model the probability of a downward movement of the underlying").subtopic).toContain("Binomial");
  });
  it("stays inside the chosen subject for a practice pack", () => {
    const g = classifyQuestion("The standard deviation of the company's earnings is closest to", "Quantitative Methods"); expect(g.topic).toBe("Quantitative Methods"); expect(g.subtopic).not.toBe("");
  });
  it("copes with empty text", () => expect(classifyQuestion("").topic).toBe("Unclassified"));
});
