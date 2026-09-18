import { isNode, LineCounter, parseDocument } from "yaml";
import { buildScene, type SceneModel } from "./scene";
import { validateDocument, type ResolvedDocument } from "./schema";

export type Diagnostic = {
  message: string;
  severity: "error" | "warning";
  line?: number;
  column?: number;
  path?: Array<string | number>;
};

export type CompileResult = {
  document?: ResolvedDocument;
  scene?: SceneModel;
  diagnostics: Diagnostic[];
};

function locate(
  doc: ReturnType<typeof parseDocument>,
  lineCounter: LineCounter,
  path: Array<string | number> | undefined,
): { line?: number; column?: number } {
  if (!path || path.length === 0) return {};
  try {
    const node = doc.getIn(path, true);
    if (isNode(node) && node.range) {
      const pos = lineCounter.linePos(node.range[0]);
      return { line: pos.line, column: pos.col };
    }
  } catch {
    return {};
  }
  return {};
}

export function compileDocument(text: string): CompileResult {
  const lineCounter = new LineCounter();
  const yamlDoc = parseDocument(text, { lineCounter, prettyErrors: true });
  const diagnostics: Diagnostic[] = [];

  for (const error of yamlDoc.errors) {
    const pos = error.linePos?.[0];
    diagnostics.push({
      message: error.message,
      severity: "error",
      line: pos?.line,
      column: pos?.col,
    });
  }
  for (const warning of yamlDoc.warnings) {
    const pos = warning.linePos?.[0];
    diagnostics.push({
      message: warning.message,
      severity: "warning",
      line: pos?.line,
      column: pos?.col,
    });
  }

  if (yamlDoc.errors.length > 0) {
    return { diagnostics };
  }

  const data = yamlDoc.toJS();
  const validated = validateDocument(data);
  for (const issue of validated.issues) {
    diagnostics.push({
      message: issue.message,
      severity: "error",
      path: issue.path,
      ...locate(yamlDoc, lineCounter, issue.path),
    });
  }

  if (!validated.document) {
    return { diagnostics };
  }

  const built = buildScene(validated.document);
  for (const issue of built.issues) {
    diagnostics.push({
      message: issue.message,
      severity: "error",
      path: issue.path,
      ...locate(yamlDoc, lineCounter, issue.path),
    });
  }

  if (!built.scene || built.issues.length > 0) {
    return { document: validated.document, diagnostics };
  }

  return {
    document: validated.document,
    scene: built.scene,
    diagnostics,
  };
}
