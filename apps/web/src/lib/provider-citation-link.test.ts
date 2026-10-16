import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ProviderCitationLink } from "../app/ui/provider-citation-link";

test.each(["https://example.com/source", "http://example.com/source"])("safe provider citation %s remains clickable", url => {
  const html = renderToStaticMarkup(createElement(ProviderCitationLink, { citation: { url, title: "Source title" } }));
  expect(html).toContain(`<a href="${url}"`); expect(html).toContain('rel="noreferrer"'); expect(html).toContain("Source title");
});

test.each(["javascript:alert(1)", "data:text/html,private", "file:///private", "https://user:secret@example.com/source", "invalid historical URL"])(
  "unsafe historical citation %s retains visible provenance without a link", url => {
    const html = renderToStaticMarkup(createElement(ProviderCitationLink, { citation: { url, title: "Historical title" } }));
    expect(html).not.toContain("<a"); expect(html).toContain(url); expect(html).toContain("Historical title");
  },
);
