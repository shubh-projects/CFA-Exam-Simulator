import type { ParsedQuestion } from "./types";

export const CFA_TOPICS = [
  "Ethical and Professional Standards", "Quantitative Methods", "Economics",
  "Financial Statement Analysis", "Corporate Issuers", "Equity Investments",
  "Fixed Income", "Derivatives", "Alternative Investments", "Portfolio Management",
] as const;

const RULES: Array<[typeof CFA_TOPICS[number], RegExp]> = [
  ["Ethical and Professional Standards", /\b(gips|standard|cfa institute|ethic|professional conduct)\b/i],
  ["Corporate Issuers", /\b(wacc|capital structure|stakeholder|corporate issuer|dividend policy)\b/i],
  ["Fixed Income", /\b(duration|bond|yield|coupon|maturity|credit spread)\b/i],
  ["Derivatives", /\b(option|forward|swap|futures|derivative)\b/i],
  ["Financial Statement Analysis", /\b(income statement|balance sheet|cash flow|inventory|revenue recognition)\b/i],
  ["Quantitative Methods", /\b(regression|probability|hypothesis|standard deviation|sampling)\b/i],
  ["Economics", /\b(inflation|gdp|exchange rate|demand|supply|monetary policy)\b/i],
  ["Equity Investments", /\b(equity|stock|share|price.to.earnings|dividend yield)\b/i],
  ["Alternative Investments", /\b(hedge fund|private equity|real estate|commodity)\b/i],
  ["Portfolio Management", /\b(portfolio|asset allocation|beta|benchmark|risk tolerance)\b/i],
];

export function classifyTopic(text: string): typeof CFA_TOPICS[number] {
  return RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "Portfolio Management";
}

export function withTopic(question: Omit<ParsedQuestion, "topic">): ParsedQuestion {
  return { ...question, topic: classifyTopic(`${question.stem} ${question.A} ${question.B} ${question.C}`) };
}
