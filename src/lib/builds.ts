export type BuildRecord = {
  id: string;
  name: string;
  yaml: string;
  updatedAt: number;
  memberCount: number;
};

export type BuildsFile = {
  version: 1;
  exportedAt: string;
  builds: BuildRecord[];
};

export class BuildsFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildsFileError";
  }
}

export function serializeBuilds(builds: BuildRecord[], exportedAt = new Date()): string {
  const file: BuildsFile = {
    version: 1,
    exportedAt: exportedAt.toISOString(),
    builds,
  };
  return JSON.stringify(file, null, 2);
}

export function buildsExportFilename(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `truecuts-builds-${year}-${month}-${day}.json`;
}

function asRecord(value: unknown, index: number): BuildRecord {
  if (!value || typeof value !== "object") {
    throw new BuildsFileError(`Build ${index + 1} is not an object`);
  }
  const record = value as Partial<BuildRecord>;
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new BuildsFileError(`Build ${index + 1} is missing an id`);
  }
  if (typeof record.name !== "string" || record.name.length === 0) {
    throw new BuildsFileError(`Build ${index + 1} is missing a name`);
  }
  if (typeof record.yaml !== "string") {
    throw new BuildsFileError(`Build ${index + 1} is missing YAML`);
  }
  if (typeof record.updatedAt !== "number" || !Number.isFinite(record.updatedAt)) {
    throw new BuildsFileError(`Build ${index + 1} has an invalid updatedAt`);
  }
  if (typeof record.memberCount !== "number" || !Number.isFinite(record.memberCount)) {
    throw new BuildsFileError(`Build ${index + 1} has an invalid memberCount`);
  }
  return {
    id: record.id,
    name: record.name,
    yaml: record.yaml,
    updatedAt: record.updatedAt,
    memberCount: record.memberCount,
  };
}

export function parseBuildsFile(text: string): BuildRecord[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BuildsFileError("File is not valid JSON");
  }
  if (!data || typeof data !== "object") {
    throw new BuildsFileError("Builds file must be an object");
  }
  const file = data as Partial<BuildsFile>;
  if (file.version !== 1) {
    throw new BuildsFileError("Unsupported builds file version");
  }
  if (!Array.isArray(file.builds)) {
    throw new BuildsFileError("Builds file is missing a builds list");
  }
  return file.builds.map((item, index) => asRecord(item, index));
}

function uniqueId(id: string, used: Set<string>): string {
  if (!used.has(id)) return id;
  let suffix = 2;
  while (used.has(`${id}-${suffix}`)) suffix += 1;
  return `${id}-${suffix}`;
}

/** Keep every existing build and append incoming ones, renaming ids that collide. */
export function mergeBuilds(existing: BuildRecord[], incoming: BuildRecord[]): BuildRecord[] {
  const used = new Set(existing.map((build) => build.id));
  const added = incoming.map((build) => {
    const id = uniqueId(build.id, used);
    used.add(id);
    return id === build.id ? build : { ...build, id };
  });
  return [...existing, ...added];
}

export function applyImport(
  existing: BuildRecord[],
  incoming: BuildRecord[],
  mode: "merge" | "replace",
): BuildRecord[] {
  if (mode === "replace") return incoming.map((build) => ({ ...build }));
  return mergeBuilds(existing, incoming);
}
