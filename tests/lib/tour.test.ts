import { describe, expect, it } from "vitest";
import { dockAt, tourSteps, type Box } from "@/lib/tour";

describe("dockAt", () => {
  it("given no spotlight, centres the card", () => {
    expect(dockAt(null, 800)).toBe("center");
  });

  it("given a target in the top half, docks the card below it", () => {
    const spot: Box = { top: 100, left: 20, width: 120, height: 40 };

    expect(dockAt(spot, 800)).toBe("bottom");
  });

  it("given a target in the bottom half, docks the card above it", () => {
    const spot: Box = { top: 600, left: 20, width: 120, height: 40 };

    expect(dockAt(spot, 800)).toBe("top");
  });

  it("given a tall target that starts low, docks the card above it", () => {
    const spot: Box = { top: 500, left: 20, width: 120, height: 400 };

    expect(dockAt(spot, 800)).toBe("top");
  });

  it("given a target that straddles the middle, docks by where its centre sits", () => {
    const spot: Box = { top: 100, left: 20, width: 120, height: 200 };

    expect(dockAt(spot, 800)).toBe("bottom");
  });
});

describe("tourSteps", () => {
  it("given no books and no install hint, opens and closes with an anchor-free step", () => {
    const steps = tourSteps({ books: false, install: false });

    expect(steps[0]?.anchor).toBeNull();
    expect(steps.at(-1)?.anchor).toBeNull();
  });

  it("given no books and no install hint, leaves out the install and book steps", () => {
    const steps = tourSteps({ books: false, install: false });

    expect(steps.map((step) => step.anchor)).toEqual([null, "import", null]);
  });

  it("given an install hint, includes the install step", () => {
    const steps = tourSteps({ books: false, install: true });

    expect(steps.map((step) => step.anchor)).toEqual([null, "import", "install", null]);
  });

  it("given books, includes the book step", () => {
    const steps = tourSteps({ books: true, install: false });

    expect(steps.map((step) => step.anchor)).toEqual([null, "import", "book", null]);
  });

  it("given books and an install hint, returns five steps in order", () => {
    const steps = tourSteps({ books: true, install: true });

    expect(steps).toHaveLength(5);
    expect(steps.map((step) => step.anchor)).toEqual([null, "import", "install", "book", null]);
  });
});
