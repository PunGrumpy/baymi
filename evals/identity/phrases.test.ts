import { describe, expect, it } from "vitest";

import { LEAD_ROLE, SECURITY_REVIEW } from "./phrases";

describe("the lead role pattern", () => {
  it.each([
    "I'm Baymi, PunGrumpy's engineering lead and security reviewer.",
    "I work with PunGrumpy on their repositories: I lead open pull requests toward merge, review every new pull request and every push for security.",
    "I own the loop on PunGrumpy's open pull requests.",
    "I chase their open pull requests toward merge.",
    "ผมเป็นหัวหน้าวิศวกรของ PunGrumpy",
  ])("accepts %s", (reply) => {
    expect(LEAD_ROLE.test(reply)).toBeTruthy();
  });

  it.each([
    "I'm Baymi. I review pull requests for security.",
    "The lead of the project merges pull requests.",
    "Baymi reads a diff and says what could hurt you.",
  ])("rejects %s", (reply) => {
    expect(LEAD_ROLE.test(reply)).toBeFalsy();
  });
});

describe("the security review pattern", () => {
  it.each([
    "I'm the security reviewer on every pull request.",
    "I review every new pull request and every push for security.",
    "I look for vulnerabilities in each change.",
    "ผมตรวจความปลอดภัยของทุก pull request",
  ])("accepts %s", (reply) => {
    expect(SECURITY_REVIEW.test(reply)).toBeTruthy();
  });

  it.each([
    "I'm Baymi, PunGrumpy's engineering lead. I review pull requests and chase them to merge.",
    "ผมเป็นหัวหน้าวิศวกร คอยตรวจ pull request ให้",
  ])("rejects a reply that leaves the security review out: %s", (reply) => {
    expect(SECURITY_REVIEW.test(reply)).toBeFalsy();
  });
});
