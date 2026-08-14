import assert from "node:assert/strict";
import test from "node:test";
import { kickerPlayerNewsLink } from "./kicker-links.ts";

test("uses Arthur's stable player ID for the verified kicker news slug", () => {
  assert.deepEqual(kickerPlayerNewsLink("pl-k00144843", "Arthur"), {
    url: "https://www.kicker.de/arthur-5/spieler-news",
    direct: true,
  });
  assert.deepEqual(kickerPlayerNewsLink("pl-k00101435", "Lars Lokotsch"), {
    url: "https://www.kicker.de/lars-lokotsch/spieler-news",
    direct: true,
  });
});

test("keeps same-name player news archives distinct by stable ID", () => {
  assert.equal(kickerPlayerNewsLink("pl-k00068029", "Jonas Hofmann").url, "https://www.kicker.de/jonas-hofmann/spieler-news");
  assert.equal(kickerPlayerNewsLink("pl-k00072881", "Jonas Hofmann").url, "https://www.kicker.de/jonas-hofmann-2/spieler-news");
  assert.equal(kickerPlayerNewsLink("pl-k00079914", "Marvin Schulz").url, "https://www.kicker.de/marvin-schulz/spieler-news");
  assert.equal(kickerPlayerNewsLink("pl-k00154558", "Marvin Schulz").url, "https://www.kicker.de/marvin-schulz-2/spieler-news");
});

test("uses an honest site-restricted search instead of guessing an unverified kicker slug", () => {
  const link = kickerPlayerNewsLink("pl-unknown", "Ada Beispiel");
  assert.equal(link.direct, false);
  assert.equal(new URL(link.url).hostname, "www.google.com");
  assert.equal(new URL(link.url).searchParams.get("q"), 'site:kicker.de inurl:spieler-news "Ada Beispiel"');
});
