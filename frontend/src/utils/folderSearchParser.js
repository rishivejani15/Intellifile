/**
 * Client-side folder query parser for React components.
 * Mirrored from frontend/folderSearchParser.js to allow immediate HMR execution
 * without waiting for an Electron restart.
 */

const MONTH_NAMES = [
  "january", "jan", "february", "feb", "march", "mar",
  "april", "apr", "may", "june", "jun", "july", "jul",
  "august", "aug", "september", "sep", "sept",
  "october", "oct", "november", "nov", "december", "dec",
];

const COMMON_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf",
  "csv", "tsv", "json", "xml", "html", "htm", "md",
  "jpg", "jpeg", "png", "gif", "bmp", "svg", "webp",
  "mp3", "wav", "flac", "mp4", "mkv", "avi", "mov",
  "zip", "rar", "7z", "tar", "gz",
  "py", "js", "ts", "jsx", "tsx", "java", "c", "cpp", "h", "cs", "go", "rs", "php", "rb", "sql", "sh", "bat", "ps1",
  "exe", "dll", "iso",
]);

const DISALLOWED_STARTING_WORDS = [
  // prepositions
  "from", "in", "of", "inside", "under", "within", "into",
  "at", "on", "by", "for", "to", "with", "about",
  "regarding", "concerning", "related to", "relative to",
  "containing", "contains", "content", "contents",
  "having", "has",
  // date / time operators
  "after", "before", "during", "since", "until", "between",
  "modified", "created", "updated",
  "newer than", "older than",
  // search specifiers
  "named", "called", "matching", "tagged", "tag", "type", "ext", "extension",
];

const IGNORED_FOLDER_NAMES = new Set([
  "new", "create", "current", "parent", "root", "sub", "this", "that",
  "a", "an", "the", "in", "of", "from", "inside", "under", "within", "into",
  "and", "or", "for", "to", "at", "by", "on", "with", "about",
  "file", "files", "folder", "folders", "dir", "dirs", "directory", "directories",
]);

function isDateOrTimeExpression(str) {
  const s = str.trim().toLowerCase();
  if (!s) return false;
  if (/^(?:19|20)\d{2}$/.test(s)) return true;
  if (/^(?:today|yesterday|tomorrow|last\s+week|last\s+month|last\s+year|this\s+week|this\s+month|this\s+year|past\s+week|past\s+month|past\s+year)$/i.test(s)) return true;
  const monthPattern = MONTH_NAMES.join("|");
  if (new RegExp(`^(?:${monthPattern})(?:\\s+(?:\\d{1,2}(?:st|nd|rd|th)?|\\d{4}))?$`, "i").test(s)) return true;
  if (new RegExp(`^(?:\\d{1,2}(?:st|nd|rd|th)?\\s+)?(?:${monthPattern})(?:\\s+\\d{4})?$`, "i").test(s)) return true;
  return false;
}

function cleanFolderCandidate(rawCandidate, hasExplicitFolderKeyword = false) {
  if (!rawCandidate) return null;
  const trimmed = rawCandidate.replace(/^['"()[\]{}]+|['"()[\]{}]+$/g, "").replace(/\s+/g, " ").trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  if (IGNORED_FOLDER_NAMES.has(lower)) {
    return null;
  }

  if (!hasExplicitFolderKeyword) {
    for (const word of DISALLOWED_STARTING_WORDS) {
      if (lower === word || lower.startsWith(word + " ")) {
        return null;
      }
    }

    if (isDateOrTimeExpression(lower)) {
      return null;
    }

    const extMatch = lower.replace(/^\./, "");
    if (lower.startsWith(".") || COMMON_EXTENSIONS.has(extMatch)) {
      return null;
    }
  }

  return trimmed;
}

export function parseFolderSearchQuery(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (!query) return null;

  if (/^(?:create|make|delete|remove|rename)\s+/i.test(query)) {
    return null;
  }

  // 1. With preposition: in, of, from, inside, under, within, into
  const prepMatch = query.match(
    /^(?:(?:show|list|get|find|open|display)\s+)?(?:(?:all\s+)?files?|all)\s+(in|of|from|inside|under|within|into)\s+(?:(?:the|a)\s+)?(?:(?:folder|dir|directory)\s+)?(?:(?:named|called)\s+)?(.+?)\s*$/i
  );
  if (prepMatch) {
    const hasFolderWord = /\b(?:folder|dir|directory)\b/i.test(query);
    const folderName = cleanFolderCandidate(prepMatch[2], hasFolderWord);
    return folderName ? { folderName } : null;
  }

  // 2. Explicit folder keyword after "files" without preposition: e.g. "all files folder downloads", "files folder downloads"
  const filesFolderMatch = query.match(
    /^(?:(?:show|list|get|open|display)\s+)?(?:(?:all\s+)?files?|all)\s+(?:(?:the|a)\s+)?(?:folder|dir|directory)\s+(?:(?:named|called)\s+)?(.+?)\s*$/i
  );
  if (filesFolderMatch) {
    const folderName = cleanFolderCandidate(filesFolderMatch[1], true);
    if (folderName) return { folderName };
  }

  // 3. Prefix folder keyword: e.g. "folder downloads", "directory projects"
  const folderPrefixMatch = query.match(
    /^(?:(?:show|list|get|open|display)\s+)?(?:(?:the|a)\s+)?(?:folder|dir|directory)\s+(?:(?:named|called)\s+)?(.+?)\s*$/i
  );
  if (folderPrefixMatch) {
    const folderName = cleanFolderCandidate(folderPrefixMatch[1], true);
    if (folderName) return { folderName };
  }

  // 4. Suffix folder keyword: e.g. "downloads folder", "downloads folder files"
  const folderSuffixMatch = query.match(
    /^(?:(?:show|list|get|open|display)\s+)?(?:(?:all|the|a)\s+)?(.+?)\s+(?:folder|dir|directory)(?:\s+files?)?\s*$/i
  );
  if (folderSuffixMatch) {
    const folderName = cleanFolderCandidate(folderSuffixMatch[1], true);
    if (folderName) return { folderName };
  }

  // 5. No preposition and no folder keyword: e.g. "all files downloads", "files downloads"
  const noPrepMatch = query.match(
    /^(?:(?:show|list|get|open|display)\s+)?(?:(?:all\s+)?files?|all)\s+(.+?)\s*$/i
  );
  if (noPrepMatch) {
    const folderName = cleanFolderCandidate(noPrepMatch[1], false);
    if (folderName) return { folderName };
  }

  return null;
}
