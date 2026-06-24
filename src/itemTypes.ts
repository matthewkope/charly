// Zotero-style item types and their metadata fields.

export interface ItemTypeDef {
  key: string;
  label: string;
}

// The handful shown at the top of the "New Item" menu.
export const COMMON_TYPES: ItemTypeDef[] = [
  { key: "book", label: "Book" },
  { key: "bookSection", label: "Book Section" },
  { key: "document", label: "Document" },
  { key: "journalArticle", label: "Journal Article" },
  { key: "newspaperArticle", label: "Newspaper Article" },
];

// The full, alphabetical list (mirrors Zotero).
export const ALL_TYPES: ItemTypeDef[] = [
  { key: "artwork", label: "Artwork" },
  { key: "audioRecording", label: "Audio Recording" },
  { key: "bill", label: "Bill" },
  { key: "blogPost", label: "Blog Post" },
  { key: "book", label: "Book" },
  { key: "bookSection", label: "Book Section" },
  { key: "case", label: "Case" },
  { key: "conferencePaper", label: "Conference Paper" },
  { key: "dataset", label: "Dataset" },
  { key: "dictionaryEntry", label: "Dictionary Entry" },
  { key: "document", label: "Document" },
  { key: "email", label: "E-mail" },
  { key: "encyclopediaArticle", label: "Encyclopedia Article" },
  { key: "film", label: "Film" },
  { key: "forumPost", label: "Forum Post" },
  { key: "hearing", label: "Hearing" },
  { key: "instantMessage", label: "Instant Message" },
  { key: "interview", label: "Interview" },
  { key: "journalArticle", label: "Journal Article" },
  { key: "letter", label: "Letter" },
  { key: "magazineArticle", label: "Magazine Article" },
  { key: "manuscript", label: "Manuscript" },
  { key: "map", label: "Map" },
  { key: "newspaperArticle", label: "Newspaper Article" },
  { key: "patent", label: "Patent" },
  { key: "podcast", label: "Podcast" },
  { key: "preprint", label: "Preprint" },
  { key: "presentation", label: "Presentation" },
  { key: "radioBroadcast", label: "Radio Broadcast" },
  { key: "report", label: "Report" },
  { key: "computerProgram", label: "Software" },
  { key: "standard", label: "Standard" },
  { key: "statute", label: "Statute" },
  { key: "thesis", label: "Thesis" },
  { key: "tvBroadcast", label: "TV Broadcast" },
  { key: "videoRecording", label: "Video Recording" },
];

export function typeLabel(key: string): string {
  return ALL_TYPES.find((t) => t.key === key)?.label ?? key;
}

// Human labels for metadata field keys.
export const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  publicationTitle: "Publication",
  publisher: "Publisher",
  place: "Place",
  date: "Date",
  volume: "Volume",
  issue: "Issue",
  section: "Section",
  partNumber: "Part Number",
  partTitle: "Part Title",
  pages: "Pages",
  series: "Series",
  seriesTitle: "Series Title",
  seriesText: "Series Text",
  journalAbbreviation: "Journal Abbr",
  DOI: "DOI",
  citationKey: "Citation Key",
  url: "URL",
  accessDate: "Accessed",
  PMID: "PMID",
  PMCID: "PMCID",
  ISSN: "ISSN",
  ISBN: "ISBN",
  archive: "Archive",
  archiveLocation: "Loc. in Archive",
  shortTitle: "Short Title",
  language: "Language",
  libraryCatalog: "Library Catalog",
  callNumber: "Call Number",
  license: "License",
  edition: "Edition",
  extra: "Extra",
};

// Journal Article field order, mirroring the reference screenshot.
const JOURNAL_ARTICLE: string[] = [
  "title",
  "publicationTitle",
  "publisher",
  "place",
  "date",
  "volume",
  "issue",
  "section",
  "partNumber",
  "partTitle",
  "pages",
  "series",
  "seriesTitle",
  "seriesText",
  "journalAbbreviation",
  "DOI",
  "citationKey",
  "url",
  "accessDate",
  "PMID",
  "PMCID",
  "ISSN",
  "archive",
  "archiveLocation",
  "shortTitle",
  "language",
  "libraryCatalog",
  "callNumber",
  "license",
  "extra",
];

const BOOK: string[] = [
  "title",
  "publisher",
  "place",
  "date",
  "edition",
  "volume",
  "series",
  "pages",
  "ISBN",
  "DOI",
  "url",
  "shortTitle",
  "language",
  "callNumber",
  "extra",
];

const DEFAULT_FIELDS: string[] = [
  "title",
  "publicationTitle",
  "date",
  "publisher",
  "place",
  "pages",
  "DOI",
  "url",
  "shortTitle",
  "language",
  "extra",
];

const TYPE_FIELDS: Record<string, string[]> = {
  journalArticle: JOURNAL_ARTICLE,
  book: BOOK,
  bookSection: BOOK,
  conferencePaper: JOURNAL_ARTICLE,
  preprint: JOURNAL_ARTICLE,
  report: DEFAULT_FIELDS,
  thesis: DEFAULT_FIELDS,
};

/** Ordered metadata field keys for a given item type. */
export function fieldsFor(itemType: string): string[] {
  return TYPE_FIELDS[itemType] ?? DEFAULT_FIELDS;
}
