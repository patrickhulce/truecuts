import { describe, expect, it } from "vitest";
import {
  applyImport,
  BuildsFileError,
  buildsExportFilename,
  mergeBuilds,
  parseBuildsFile,
  serializeBuilds,
  type BuildRecord,
} from "./builds";

const bench: BuildRecord = {
  id: "bench",
  name: "Bench",
  yaml: "version: 1\nname: Bench\n",
  updatedAt: 1,
  memberCount: 2,
};

const stool: BuildRecord = {
  id: "stool",
  name: "Stool",
  yaml: "version: 1\nname: Stool\n",
  updatedAt: 2,
  memberCount: 4,
};

describe("serializeBuilds", () => {
  it("writes a versioned backup", () => {
    const text = serializeBuilds([bench], new Date("2026-09-25T12:00:00.000Z"));
    expect(JSON.parse(text)).toEqual({
      version: 1,
      exportedAt: "2026-09-25T12:00:00.000Z",
      builds: [bench],
    });
    expect(buildsExportFilename(new Date(2026, 8, 25))).toBe("truecuts-builds-2026-09-25.json");
  });
});

describe("parseBuildsFile", () => {
  it("round-trips a backup", () => {
    expect(parseBuildsFile(serializeBuilds([bench, stool]))).toEqual([bench, stool]);
  });

  it("rejects an unsupported version", () => {
    expect(() => parseBuildsFile(JSON.stringify({ version: 2, builds: [] }))).toThrow(BuildsFileError);
  });

  it("rejects a build missing yaml", () => {
    expect(() =>
      parseBuildsFile(JSON.stringify({ version: 1, builds: [{ id: "a", name: "A", updatedAt: 1, memberCount: 0 }] })),
    ).toThrow(/missing YAML/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseBuildsFile("{")).toThrow(/not valid JSON/);
  });
});

describe("mergeBuilds", () => {
  it("keeps existing builds and appends new ones", () => {
    expect(mergeBuilds([bench], [stool])).toEqual([bench, stool]);
  });

  it("renames an incoming id that collides", () => {
    const incoming = { ...stool, id: "bench", name: "Other bench" };
    expect(mergeBuilds([bench], [incoming])).toEqual([bench, { ...incoming, id: "bench-2" }]);
  });

  it("replaces the library when asked", () => {
    expect(applyImport([bench], [stool], "replace")).toEqual([stool]);
    expect(applyImport([bench], [stool], "merge")).toEqual([bench, stool]);
  });
});
