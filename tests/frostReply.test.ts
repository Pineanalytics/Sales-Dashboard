import { describe, expect, it } from "vitest";
import { parseFrostReply } from "../lib/frost/agent";

describe("parseFrostReply", () => {
  it("returns plain text unchanged when there's no trailing JSON block", () => {
    const result = parseFrostReply("MTD sales are on track.");
    expect(result).toEqual({ text: "MTD sales are on track." });
  });

  it("splits prose from a valid metrics/followUps block", () => {
    const raw =
      'MTD sales are KES 8.5M against a KES 10M target.\n\n' +
      '```json\n' +
      '{"metrics": [{"label": "Revenue", "value": "KES 8.5M"}, {"label": "Achievement", "value": "85%"}], "followUps": ["Why are we behind target?"]}\n' +
      '```';
    const result = parseFrostReply(raw);
    expect(result.text).toBe("MTD sales are KES 8.5M against a KES 10M target.");
    expect(result.metrics).toEqual([
      { label: "Revenue", value: "KES 8.5M" },
      { label: "Achievement", value: "85%" },
    ]);
    expect(result.followUps).toEqual(["Why are we behind target?"]);
  });

  it("falls back to the raw text when the trailing block isn't valid JSON", () => {
    const raw = "Some answer.\n\n```json\nnot actually json\n```";
    const result = parseFrostReply(raw);
    expect(result).toEqual({ text: raw.trim() });
  });

  it("drops malformed metric/followUp entries instead of throwing", () => {
    const raw =
      "Answer.\n\n```json\n" +
      '{"metrics": [{"label": "OK", "value": "1"}, {"label": "missing value"}, "not an object"], "followUps": ["good", 42, null]}\n' +
      "```";
    const result = parseFrostReply(raw);
    expect(result.metrics).toEqual([{ label: "OK", value: "1" }]);
    expect(result.followUps).toEqual(["good"]);
  });

  it("caps metrics at 4 and followUps at 3", () => {
    const metrics = Array.from({ length: 6 }, (_, i) => ({ label: `M${i}`, value: `${i}` }));
    const followUps = Array.from({ length: 5 }, (_, i) => `Q${i}`);
    const raw = `Answer.\n\n\`\`\`json\n${JSON.stringify({ metrics, followUps })}\n\`\`\``;
    const result = parseFrostReply(raw);
    expect(result.metrics).toHaveLength(4);
    expect(result.followUps).toHaveLength(3);
  });

  it("ignores a JSON block that doesn't appear at the very end", () => {
    const raw = "```json\n{\"metrics\": []}\n```\n\nThen more prose after it.";
    const result = parseFrostReply(raw);
    expect(result).toEqual({ text: raw.trim() });
  });
});
