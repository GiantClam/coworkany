import test from "node:test";
import assert from "node:assert/strict";
import { filterAssetLibraryItems } from "../src/asset-library-filter";

const now = Date.parse("2026-09-05T12:00:00.000Z");
const items = [
  { id: "image", relative_path: "images/cover.png", mime_type: "image/png", created_at: "2026-09-05T11:00:00.000Z" },
  { id: "ppt", relative_path: "presentations/demo.pptx", mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", created_at: "2026-09-03T12:00:00.000Z" },
  { id: "old-document", relative_path: "drafts/brief.md", mime_type: "text/markdown", created_at: "2026-08-20T12:00:00.000Z" },
  { id: "old-video", relative_path: "videos/launch.mp4", mime_type: "video/mp4", created_at: "2026-08-20T12:00:00.000Z" },
];

test("asset library tabs filter the loaded card list in time order", () => {
  assert.deepEqual(filterAssetLibraryItems(items, "all", "", now).map((item) => item.id), ["image", "ppt", "old-document", "old-video"]);
  assert.deepEqual(filterAssetLibraryItems(items, "recent", "", now).map((item) => item.id), ["image", "ppt"]);
  assert.deepEqual(filterAssetLibraryItems(items, "documents", "", now).map((item) => item.id), ["ppt", "old-document"]);
  assert.deepEqual(filterAssetLibraryItems(items, "all", "brief", now).map((item) => item.id), ["old-document"]);
});

test("asset library sorts matching assets from newest to oldest", () => {
  const unsorted = [items[2], items[0], items[3], items[1]];

  assert.deepEqual(filterAssetLibraryItems(unsorted, "all", "", now).map((item) => item.id), ["image", "ppt", "old-document", "old-video"]);
});
