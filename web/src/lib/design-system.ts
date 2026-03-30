export const DS = {
  // Backgrounds
  bg:       '#020508',   // deepest background
  surface:  '#060d18',   // card backgrounds
  panel:    '#0a1525',   // inner panels
  panelHi:  '#0f1d34',   // hover states

  // Borders
  border:   'rgba(30,80,140,0.28)',
  borderHi: 'rgba(56,189,248,0.5)',

  // Accent colors
  sky:      '#38bdf8',   // primary blue — revenue
  emerald:  '#10b981',   // green — positive growth
  violet:   '#8b5cf6',   // purple — customers
  amber:    '#f59e0b',   // yellow — inventory/alerts
  rose:     '#f43f5e',   // red — negative/returns
  cyan:     '#22d3ee',   // teal — sessions/sync
  lime:     '#84cc16',   // green-yellow — conversion
  orange:   '#f97316',   // orange — marketing spend
  indigo:   '#6366f1',   // indigo — regional

  // Text
  hi:    '#e2f0ff',      // headings
  mid:   '#7799bb',      // body text
  lo:    '#2a4060',      // labels, muted

  // Fonts
  display: "'Playfair Display', Georgia, serif",
  body:    "'Outfit', system-ui, sans-serif",
  mono:    "'IBM Plex Mono', Consolas, monospace",
};

export const CHART_PALETTE = [
  DS.sky, DS.emerald, DS.violet, DS.amber,
  DS.rose, DS.cyan, DS.lime, DS.orange, DS.indigo
];
