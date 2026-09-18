// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UsagePage } from "./UsagePage";
vi.mock("./UsageDashboard", () => ({ UsageDashboard: () => <div>Usage dashboard content</div> }));
afterEach(cleanup);
it("renders a standalone dashboard and navigates back home", () => {
  window.location.hash = "#/usage";
  render(<UsagePage locale="en" />);
  expect(screen.getByText("Usage dashboard content")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back to app" }));
  expect(window.location.hash).toBe("#/home");
});
