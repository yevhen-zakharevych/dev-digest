import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Markdown } from "./Markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("strips javascript: hrefs to prevent XSS via repo-authored links", () => {
    render(<Markdown>{"[click me](javascript:alert(1))"}</Markdown>);
    const link = screen.getByText("click me");
    expect(link.getAttribute("href")).toBeNull();
  });

  it("keeps safe http(s) hrefs", () => {
    render(<Markdown>{"[docs](https://example.com/readme)"}</Markdown>);
    const link = screen.getByText("docs");
    expect(link.getAttribute("href")).toBe("https://example.com/readme");
  });

  it("keeps relative and anchor hrefs", () => {
    render(<Markdown>{"[section](#intro) and [file](./README.md)"}</Markdown>);
    expect(screen.getByText("section").getAttribute("href")).toBe("#intro");
    expect(screen.getByText("file").getAttribute("href")).toBe("./README.md");
  });

  it("does not render raw HTML tags embedded in repo content", () => {
    render(<Markdown>{'<img src=x onerror="alert(1)">plain text</Markdown>'}</Markdown>);
    expect(document.querySelector("img")).toBeNull();
  });
});
