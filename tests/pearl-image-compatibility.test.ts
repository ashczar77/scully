import { expect, it } from "vitest";
import { imageCompatibilityWarning } from "../src/renderer/pearl-image-compatibility";

const manifest = (path: string) => [{ path, bytes: 10, sha256: "digest" }];

it("warns when a Java project is paired with a Node image", () => {
  expect(imageCompatibilityWarning(manifest("pom.xml"), "node:22")).toMatch(
    /Java project/,
  );
});

it("does not warn for a matching image or an unknown project stack", () => {
  expect(
    imageCompatibilityWarning(manifest("src/Main.java"), "eclipse-temurin:21"),
  ).toBeNull();
  expect(
    imageCompatibilityWarning(manifest("README.md"), "node:22"),
  ).toBeNull();
});
