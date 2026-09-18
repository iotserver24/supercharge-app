// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageDashboard } from "./UsageDashboard";
import { emptyCounts } from "@/lib/usageDashboard";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/api/host", () => ({ invoke }));
vi.mock("./Heatmap", () => ({ Heatmap: ({ onSelectRange }: { onSelectRange: (range: {start: string; end: string}) => void }) => <button onClick={() => onSelectRange({start: "2026-09-17", end: "2026-09-17"})}>Select day</button> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("UsageDashboard", () => {
  it("loads recorded totals, switches granularity, and clears filters", async () => {
    const row = { ...emptyCounts(), totalTokens: 123, modelCalls: 2, usageIsIncomplete: false, modelUsage: { "test-model": { ...emptyCounts(), totalTokens: 123 } } };
    invoke.mockResolvedValue({ sessions: [{ sessionId: "s", updatedAt: "", session: row, turns: [{ ...row, turnNumber: 1, endedAt: "2026-09-17T12:00:00Z" }] }], skippedFiles: 0, truncated: false });
    render(<UsageDashboard locale="en" />);
    await screen.findByText("test-model");
    expect(invoke).toHaveBeenCalledWith("usage_dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Select day" }));
    fireEvent.click(screen.getByRole("button", { name: /Show all/ }));
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });
  it("reports errors and supports retry without fabricating records", async () => {
    invoke.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce({ sessions: [], skippedFiles: 0, truncated: false });
    render(<UsageDashboard locale="en" />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  });
});
