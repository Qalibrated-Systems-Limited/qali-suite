// ============================================
// MAIN SITE HEADER - Most Common Use
// ============================================
export function SiteHeader({ title = "Dashboard", description, Action }) {
  return (
    <header className="border-b border-border bg-card shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-4 md:px-6 lg:px-8 py-4 md:py-6">
        {/* Title & Description Section */}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              {description}
            </p>
          )}
        </div>

        {/* Actions Section */}
        {Action && (
          <div className="flex items-center gap-2 shrink-0">
            <Action />
          </div>
        )}
      </div>
    </header>
  );
}

// ============================================
// SITE HEADER WITH BADGE
// ============================================
export function SiteHeaderWithBadge({
  title = "Dashboard",
  description,
  badge,
  Action,
}) {
  return (
    <header className="border-b border-border bg-card shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 px-4 md:px-6 lg:px-8 py-4 md:py-6">
        {/* Title & Description Section */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground">
              {title}
            </h1>
            {badge && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
              {description}
            </p>
          )}
        </div>

        {/* Actions Section */}
        {Action && (
          <div className="flex items-center gap-2 shrink-0 sm:mt-1">
            <Action />
          </div>
        )}
      </div>
    </header>
  );
}

// ============================================
// MINIMAL VERSION - Just Title (No Border)
// ============================================
export function SiteHeaderMinimal({ title = "Dashboard", description }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl md:text-3xl font-bold text-foreground">
        {title}
      </h1>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          {description}
        </p>
      )}
    </div>
  );
}

// ============================================
// COMPACT VERSION - Smaller Padding
// ============================================
export function SiteHeaderCompact({ title = "Dashboard", Action }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="flex items-center justify-between px-4 md:px-6 lg:px-8 py-3">
        <h1 className="text-lg md:text-xl font-bold text-foreground">
          {title}
        </h1>
        {Action && (
          <div className="flex items-center gap-2">
            <Action />
          </div>
        )}
      </div>
    </header>
  );
}

// ============================================
// WITH BREADCRUMB SUPPORT
// ============================================
export function SiteHeaderWithBreadcrumb({
  title = "Dashboard",
  description,
  breadcrumbs = [],
  Action,
}) {
  return (
    <header className="border-b border-border bg-card shadow-sm">
      <div className="px-4 md:px-6 lg:px-8 py-4 md:py-6">
        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 && (
          <nav className="flex items-center space-x-2 text-sm mb-3">
            {breadcrumbs.map((crumb, index) => (
              <div key={index} className="flex items-center">
                {index > 0 && (
                  <span className="text-muted-foreground mx-2">/</span>
                )}
                {crumb.href ? (
                  <a
                    href={crumb.href}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {crumb.label}
                  </a>
                ) : (
                  <span className="text-foreground font-medium">
                    {crumb.label}
                  </span>
                )}
              </div>
            ))}
          </nav>
        )}

        {/* Title & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                {description}
              </p>
            )}
          </div>

          {Action && (
            <div className="flex items-center gap-2 shrink-0">
              <Action />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ============================================
// WITH TABS SUPPORT
// ============================================
export function SiteHeaderWithTabs({
  title = "Dashboard",
  description,
  tabs = [],
  activeTab,
  onTabChange,
  Action,
}) {
  return (
    <header className="border-b border-border bg-card shadow-sm">
      <div className="px-4 md:px-6 lg:px-8">
        {/* Title & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 py-4 md:py-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                {description}
              </p>
            )}
          </div>

          {Action && (
            <div className="flex items-center gap-2 shrink-0">
              <Action />
            </div>
          )}
        </div>

        {/* Tabs */}
        {tabs.length > 0 && (
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => onTabChange?.(tab.value)}
                className={`
                  px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                  ${
                    activeTab === tab.value
                      ? "border-yellow-500 text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }
                `}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span
                    className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                      activeTab === tab.value
                        ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
