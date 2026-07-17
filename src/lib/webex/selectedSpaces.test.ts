import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";
import { readSelectedSpaces, writeSelectedSpace } from "@/lib/webex/store";

describe("selected Webex spaces store", () => {
  let isolate: { cleanup: () => void };
  beforeEach(() => {
    isolate = useIsolatedDataDir();
  });
  afterEach(() => isolate.cleanup());

  it("starts empty, persists a per-lane space, and clears it", async () => {
    expect(await readSelectedSpaces()).toEqual({});

    await writeSelectedSpace("technical", { roomId: "ROOM123", title: "Team Space" });
    expect((await readSelectedSpaces()).technical).toEqual({ roomId: "ROOM123", title: "Team Space" });

    // A different lane is independent.
    await writeSelectedSpace("sales", { roomId: "ROOM-SALES", title: null });
    const both = await readSelectedSpaces();
    expect(both.technical?.roomId).toBe("ROOM123");
    expect(both.sales?.roomId).toBe("ROOM-SALES");

    // Clearing removes only that lane.
    await writeSelectedSpace("technical", null);
    const after = await readSelectedSpaces();
    expect(after.technical).toBeUndefined();
    expect(after.sales?.roomId).toBe("ROOM-SALES");
  });
});
