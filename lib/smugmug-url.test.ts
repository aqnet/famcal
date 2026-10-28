import { describe, expect, it } from "vitest";
import { parseSmugMugUrl, sizedUrl } from "./smugmug-url";

describe("parseSmugMugUrl", () => {
  it("reads owner, path and node ID", () => {
    expect(parseSmugMugUrl("https://owner.smugmug.com/Family/Display/n-AbC123")).toEqual({
      owner: "owner",
      path: "/Family/Display",
      nodeId: "AbC123",
    });
  });

  it("works without a node segment", () => {
    expect(parseSmugMugUrl("https://owner.smugmug.com/Family/Display")).toEqual({
      owner: "owner",
      path: "/Family/Display",
      nodeId: null,
    });
  });

  it("rejects other hosts", () => {
    expect(parseSmugMugUrl("https://example.com/n-AbC")).toBeNull();
    expect(parseSmugMugUrl("http://owner.smugmug.com/x")).toBeNull();
    expect(parseSmugMugUrl("not a url")).toBeNull();
  });
});

describe("sizedUrl", () => {
  it("swaps the size code", () => {
    expect(sizedUrl("https://photos.smugmug.com/Family/i-Xy/0/abc/Th/i-Xy-Th.jpg", "XL")).toBe(
      "https://photos.smugmug.com/Family/i-Xy/0/abc/XL/i-Xy-XL.jpg",
    );
  });
});
