## ADDED Requirements

### Requirement: Usage layout fits the available workspace width
The usage dashboard SHALL constrain its grid and panels to the available main content width and SHALL adapt cards and filters to that width independently of sidebar state.

#### Scenario: Expanded sidebar in a minimum-width desktop window
- **WHEN** the window is 1080px wide and the sidebar is expanded
- **THEN** the header, every filter, overview metric, trend chart and distribution panel SHALL be visible without clipped right-side content or page-level horizontal overflow
- **AND** filters and cards SHALL reflow within the content container

#### Scenario: Sidebar and window size change
- **WHEN** the sidebar is toggled or the window changes between 1080, 1280 and 1440px
- **THEN** the dashboard SHALL use the remaining content width without losing filters or metrics

### Requirement: Every ledger column is accessible within its scroll region
The run ledger SHALL retain all eight existing columns in a bounded horizontal scroll region and SHALL preserve row navigation behavior.

#### Scenario: Ledger is wider than its panel
- **WHEN** the ledger content exceeds its panel width
- **THEN** the panel SHALL NOT enlarge the page
- **AND** a localized overflow hint and usable scroll affordance SHALL be available
- **AND** touchpad, Shift+wheel and keyboard navigation in the focused scroll region SHALL reach the final status column

#### Scenario: Ledger fits its panel
- **WHEN** the full ledger fits inside the panel
- **THEN** the overflow hint SHALL be hidden

#### Scenario: Long task and model values
- **WHEN** a task title, model name or run ID exceeds its column width
- **THEN** it SHALL NOT enlarge the dashboard or overlap adjacent values
- **AND** the complete value SHALL remain available to accessibility tools and through a full-text viewing affordance

### Requirement: Usage secondary text is readable
Usage descriptions, metric labels, chart summaries, table headers, placeholders and run IDs SHALL use foreground tokens appropriate to their actual surfaces and SHALL meet at least 4.5:1 contrast for normal text.

#### Scenario: Light or dark theme tokens are supplied
- **WHEN** the usage page is rendered using the existing light or dark theme tokens
- **THEN** text SHALL NOT use the muted background color as its foreground
- **AND** cards and controls SHALL use corresponding semantic surface tokens
- **AND** normal secondary text SHALL meet the contrast threshold on its rendered background

### Requirement: Existing usage business behavior is preserved
The change SHALL preserve query parameters, totals, unknown values, filtering, pagination and run navigation while improving presentation.

#### Scenario: Data and request states
- **WHEN** the user changes filters or the metrics query returns loading, empty, error or data results in Chinese or English
- **THEN** the existing state and query behavior SHALL remain functional without clipped controls or unreadable explanatory text
