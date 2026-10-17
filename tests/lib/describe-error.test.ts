import { describe, expect, it } from "vitest";
import { StorageFailure } from "@/domain/errors";
import { describeError } from "@/lib/describe-error";

describe("describeError", () => {
  it("given a full store, says so", () => {
    const full = new StorageFailure({
      operation: "putFile",
      cause: new DOMException("over quota", "QuotaExceededError"),
    });
    expect(describeError(full, "Moby Dick")).toBe(
      "Moby Dick could not be saved: this device's storage for Reader Hero is full.",
    );
  });

  it("given any other storage failure, does not blame the space", () => {
    const closed = new StorageFailure({
      operation: "putFile",
      cause: new DOMException("closing", "InvalidStateError"),
    });
    expect(describeError(closed, "Moby Dick")).toBe("Moby Dick could not be saved.");
  });
});
