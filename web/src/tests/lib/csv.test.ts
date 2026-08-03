import { describe, expect, it } from "vitest";
import { buildClientCsv, safeCsvCell } from "@/lib/csv";

describe("client CSV safety", () => {
    it("adds a BOM and preserves German text, quotes, and newlines", () => {
        const csv = buildClientCsv(["Name", "Note"], [["München", "first\n\"second\""]]);
        expect(csv.startsWith("\uFEFF")).toBe(true);
        expect(csv).toContain('"München"');
        expect(csv).toContain('"first\n""second"""');
    });

    it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@cmd"])("neutralizes %s", (value) => {
        expect(safeCsvCell(value)).toBe(`"'${value}"`);
    });
});
