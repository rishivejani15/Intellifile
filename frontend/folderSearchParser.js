"use strict";

/**
 * Recognise explicit, whole-query requests for files in a named folder.
 * Returning null deliberately leaves all other queries on the existing search
 * pipeline, including conceptual searches that happen to mention a folder.
 */
function parseFolderSearchQuery(rawQuery) {
  const query = String(rawQuery || "").trim();
  const match = query.match(
    /^all\s+files?\s+(?:in|of)\s+(?:the\s+)?(?:folder\s+)?(.+?)\s*$/i,
  );
  if (!match) return null;

  const folderName = match[1].replace(/^['"]|['"]$/g, "").replace(/\s+/g, " ").trim();
  return folderName ? { folderName } : null;
}

module.exports = { parseFolderSearchQuery };
