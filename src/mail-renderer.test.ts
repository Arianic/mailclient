// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mailDocument, sanitizeMailHtml } from "./mail-renderer";

describe("untrusted email rendering", () => {
  it("keeps useful formatting while removing executable content and app hooks", () => {
    const result = sanitizeMailHtml(
      `<h2>Order confirmed</h2><p><strong>Thank you</strong></p><script>parent.__TAURI_INTERNALS__.invoke('quit_app')</script><img src=x onerror="alert(1)"><iframe src="https://attacker.example"></iframe><svg onload="alert(2)"></svg><object data="evil"></object><div data-tauri-drag-region onclick="alert(3)">Text</div>`,
    );
    expect(result).toContain("<h2>Order confirmed</h2>");
    expect(result).toContain("<strong>Thank you</strong>");
    expect(result).not.toMatch(
      /<script|<iframe|<svg|<object|onerror|onclick|__TAURI|data-tauri/i,
    );
  });
  it("removes link navigation, forms, tracking resources and CSS network requests", () => {
    const result = sanitizeMailHtml(
      `<a href="https://attacker.example" target="_top">Visit</a><form action="https://attacker.example"><input name="token"></form><img src="https://tracker.example/pixel" alt="tracking"><div style="background-image:url(https://tracker.example/css);position:fixed;color:red;padding:12px">Content</div><link rel="stylesheet" href="https://tracker.example/css"><style>@import 'https://tracker.example';</style>`,
    );
    expect(result).not.toMatch(
      /https:|href=|<form|<input|url\(|<style|<link|position:/i,
    );
    expect(result).toContain("Image blocked: tracking");
    expect(result).toContain("padding: 12px");
    expect(result).not.toContain("color: red");
  });
  it("retains original safe colors only on request without relaxing image blocking", () => {
    const result = sanitizeMailHtml(
      `<p style="color:red;background-color:white">Hello</p><img src="https://tracker.example/a">`,
      true,
    );
    expect(result).toContain("color: red");
    expect(result).not.toContain("https:");
  });
  it("allows raster data images but blocks SVG and srcset", () => {
    const result = sanitizeMailHtml(
      `<img src="data:image/png;base64,aGVsbG8=" srcset="https://tracker.example 2x"><img src="data:image/svg+xml;base64,PHN2Zz4=">`,
    );
    expect(result).toContain("data:image/png;base64,aGVsbG8=");
    expect(result).not.toMatch(/srcset|svg\+xml|tracker.example/);
  });
  it("puts a restrictive policy before all email content", () => {
    const result = mailDocument(
      '<meta http-equiv="refresh" content="0;url=https://attacker.example"><base href="https://attacker.example"><p>Body</p>',
      true,
    );
    expect(result).toContain("script-src 'none'");
    expect(result).toContain("connect-src 'none'");
    expect(result).toContain("form-action 'none'");
    expect(result.indexOf("Content-Security-Policy")).toBeLessThan(
      result.indexOf("<p>Body</p>"),
    );
    expect(result).not.toMatch(/http-equiv="refresh"|<base|attacker.example/);
  });
});

it("loads only approved raster replacements while retaining the iframe restrictions", () => {
  const source =
    '<p>Hello</p><img src="https://image.example/logo"><img src="https://tracker.example/pixel">';
  const output = mailDocument(source, false, false, {
    "https://image.example/logo": "data:image/png;base64,aGVsbG8=",
  });
  expect(output).toContain("data:image/png;base64,aGVsbG8=");
  expect(output).not.toContain("https://tracker.example");
  expect(output).not.toContain("https://image.example");
  expect(output).toContain("script-src 'none'");
  expect(output).toContain("img-src data:");
  expect(
    mailDocument(source, false, false, {
      "https://image.example/logo": "javascript:alert(1)",
    }),
  ).not.toContain("javascript:");
});
