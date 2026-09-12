export const DEFAULT_DISCUSSION_CONNECTOR_KEYS = [
  'similarweb_api1',
  'semrush13',
  'ahrefs_url_research',
  'appark',
];

export function resolveDiscussionConnectorKeys(
  remembered: string[] | undefined,
  previousMessage: string[] | null,
) {
  // An explicit empty selection means the user disabled every connector.
  return remembered ?? previousMessage ?? DEFAULT_DISCUSSION_CONNECTOR_KEYS;
}
