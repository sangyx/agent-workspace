/** Shared chrome glyphs. Original paths on a 24-unit grid, with 2-unit optical margins.
 * Keep project identity independent of colour and use the same geometry in both interfaces and hosts.
 */
export const WORKSPACE_ICON_STROKE = 1.7;
const folder = 'M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6L12 7h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z';
export const WORKSPACE_ICONS = {
  projects: 'M7 3h3.2a2 2 0 0 1 1.4.6L13 5h6a2 2 0 0 1 2 2 M3 9a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.4.6L11 9h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  folder,
  'research-folder': folder + ' M12 10l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z',
  chat: 'M7 4h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H9l-5 3v-4.5A4 4 0 0 1 3 14V8a4 4 0 0 1 4-4Z M8 9h8 M8 13h5',
  daily: 'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M9 3v7l2-1.5 2 1.5V3 M8 14h8 M8 17h5',
  gauge: 'M4 18a9 9 0 1 1 16 0 M6 12h1 M12 6v1 M17 12h1 M12 15l4-5 M9 18h6',
  settings: 'M9.8 3h4.4l.6 2.2 1.9 1.1 2.2-.6 2.2 3.8-1.6 1.6v2.2l1.6 1.6-2.2 3.8-2.2-.6-1.9 1.1-.6 2.2H9.8l-.6-2.2-1.9-1.1-2.2.6-2.2-3.8 1.6-1.6v-2.2L2.9 9.5l2.2-3.8 2.2.6 1.9-1.1Z M15.2 12a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0Z',
  graph: 'M9 3h6v5H9Z M3 16h6v5H3Z M15 16h6v5h-6Z M12 8v4 M6 16v-4h12v4',
  paper: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z M14 3v5h5 M9 12h6 M9 16h6',
  flask: 'M9 3h6 M10 3v7l-5 8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-8V3 M8 14h8',
  library: 'M4 4h4v16H4Z M11 4h3v16h-3Z M17 5l3-.5 2.5 14.8-3 .5Z',
  compose: 'M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6 M16 3l5 5 M9 15l1-4L18 3a2.1 2.1 0 0 1 3 3l-8 8Z',
} as const;
