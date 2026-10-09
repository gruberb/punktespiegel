import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const files = readdirSync(root, { recursive: true })
  .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"));
const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true };
const graph = new Map();

for (const file of files) {
  const absolute = path.join(root, file);
  const source = ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true);
  const dependencies = new Set();
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0];
    if (specifier && ts.isStringLiteral(specifier)) {
      const resolved = ts.resolveModuleName(specifier.text, absolute, options, ts.sys).resolvedModule;
      if (resolved) {
        const target = path.relative(root, resolved.resolvedFileName);
        if (!target.startsWith("..") && !path.isAbsolute(target)) dependencies.add(target);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(file, dependencies);
}

test("features are independent and shared modules cannot import features or app", () => {
  const violations = [];
  for (const [file, dependencies] of graph) {
    const [layer, feature] = file.split(path.sep);
    for (const dependency of dependencies) {
      const [targetLayer, targetFeature] = dependency.split(path.sep);
      if (layer === "features" && (targetLayer === "app" || (targetLayer === "features" && feature !== targetFeature))) {
        violations.push(`${file} imports ${dependency}`);
      }
      if (!["features", "app", "main.tsx"].includes(layer) && ["features", "app"].includes(targetLayer)) {
        violations.push(`${file} imports ${dependency}`);
      }
    }
  }
  assert.deepEqual(violations, [], "Compose features in app; move genuinely shared code below features.");
});

test("source imports contain no dependency cycles", () => {
  const visited = new Set();
  function visit(file, ancestors) {
    assert.ok(!ancestors.includes(file), `Dependency cycle: ${[...ancestors, file].join(" -> ")}`);
    if (visited.has(file)) return;
    for (const dependency of graph.get(file) ?? []) visit(dependency, [...ancestors, file]);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
});
