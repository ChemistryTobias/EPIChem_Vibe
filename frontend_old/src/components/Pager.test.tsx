/**
 * The Pager has the only conditional rendering in the shared components
 * that can be wrong in a way a user would notice: showing itself when
 * everything fits, or offering a Next that walks past the end.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { Pager } from "./Pager";

afterEach(cleanup);

const props = { limit: 50, offset: 0, onOffsetChange: () => {}, noun: "samples" };

describe("Pager", () => {
  test("renders nothing when everything fits on one page", () => {
    const { container } = render(<Pager {...props} total={50} />);

    // Plain innerHTML rather than jest-dom's toBeEmptyDOMElement — that's a
    // whole extra dependency for one assertion.
    expect(container.innerHTML).toBe("");
  });

  test("shows the current window and total", () => {
    render(<Pager {...props} total={342} />);

    expect(screen.getByText("Showing 1–50 of 342 samples")).toBeTruthy();
  });

  test("clamps the upper bound to the total on the last page", () => {
    render(<Pager {...props} offset={300} total={342} />);

    expect(screen.getByText("Showing 301–342 of 342 samples")).toBeTruthy();
  });

  test("disables Previous on the first page and Next on the last", () => {
    const { unmount } = render(<Pager {...props} total={60} />);
    expect(screen.getByText("Previous").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Next").hasAttribute("disabled")).toBe(false);
    unmount();

    render(<Pager {...props} offset={50} total={60} />);
    expect(screen.getByText("Previous").hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("Next").hasAttribute("disabled")).toBe(true);
  });

  test("steps by one page in each direction", () => {
    const onOffsetChange = vi.fn();
    render(<Pager {...props} offset={50} total={342} onOffsetChange={onOffsetChange} />);

    screen.getByText("Next").click();
    expect(onOffsetChange).toHaveBeenLastCalledWith(100);

    screen.getByText("Previous").click();
    expect(onOffsetChange).toHaveBeenLastCalledWith(0);
  });

  test("never produces a negative offset", () => {
    const onOffsetChange = vi.fn();
    render(<Pager {...props} limit={50} offset={20} total={342} onOffsetChange={onOffsetChange} />);

    screen.getByText("Previous").click();

    expect(onOffsetChange).toHaveBeenCalledWith(0);
  });
});
