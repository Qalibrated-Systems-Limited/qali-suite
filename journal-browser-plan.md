# Journal Browser Implementation Plan

## Overview
Build a modern, engaging journal entry browser that breaks traditional boring accounting UI patterns while maintaining full functionality for accountants.

---

## Phase 1: Core Journal Browser Page
**Route:** `/dashboard/journal`

### 1.1 Page Structure
```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER: Journal Entries                          [+ New Entry]  │
├─────────────────────────────────────────────────────────────────┤
│ STATS CARDS (4 cards)                                           │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│ │Total     │ │This Month│ │Drafts    │ │Reversals │            │
│ │Entries   │ │Volume    │ │Pending   │ │This Month│            │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
├─────────────────────────────────────────────────────────────────┤
│ FILTER BAR                                                      │
│ [Search...] [Period ▼] [Type ▼] [Status ▼] [Account ▼]         │
│ Active Filters: [Jan 2025 ×] [Posted ×]              Clear All  │
├─────────────────────────────────────────────────────────────────┤
│ VIEW TOGGLE                                                     │
│ [Timeline] [Grouped] [Table]                    Export ▼        │
├─────────────────────────────────────────────────────────────────┤
│ CONTENT AREA (varies by view)                                   │
│                                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 View Modes

#### Timeline View (Default - Most Engaging)
- Activity feed style with visual cards
- Grouped by date with daily totals
- Each entry shows:
  - Source icon + Entry number + Time
  - Description
  - Visual debit/credit bars (proportional)
  - Party name if applicable
  - Status badge
  - Quick actions on hover

#### Grouped View (Practical)
- Collapsible groups by: Day, Week, Entry Type, or Status
- Summary row for each group (count, total debits/credits)
- Expandable to show individual entries
- Great for reconciliation work

#### Table View (Power Users)
- Traditional data table with all columns
- Sortable columns
- Bulk selection for actions
- Best for exports and detailed analysis

### 1.3 Components to Build
1. `JournalStatsCards.tsx` - 4 metric cards with trends
2. `JournalFilterBar.tsx` - Search + filter dropdowns + chips
3. `JournalViewToggle.tsx` - View mode selector
4. `JournalTimeline.tsx` - Timeline/feed view
5. `JournalGroupedView.tsx` - Collapsible grouped view
6. `JournalTable.tsx` - Traditional table view
7. `JournalEntryCard.tsx` - Individual entry card for timeline
8. `JournalEntryRow.tsx` - Table row component
9. `DebitCreditBar.tsx` - Visual balance indicator

---

## Phase 2: Journal Entry Detail Page
**Route:** `/dashboard/journal/[id]`

### 2.1 Layout
```
┌─────────────────────────────────────────────────────────────────┐
│ [← Back] JRN-2025-0001                    [Edit] [Post] [More ▼]│
├─────────────────────────────────────────────────────────────────┤
│ STATUS BANNER (color-coded: draft=yellow, posted=green, etc)    │
├──────────────────────────────┬──────────────────────────────────┤
│ ENTRY DETAILS                │ SUMMARY                          │
│ • Entry Type: Sale           │ ┌────────────────────────────┐  │
│ • Date: Jan 15, 2025         │ │ Total Debits:  125,000    │  │
│ • Fiscal Period: Jan 2025    │ │ Total Credits: 125,000    │  │
│ • Reference: INV-2025-0042   │ │ Balance: ✓ Balanced       │  │
│ • Party: ABC Corp (Customer) │ └────────────────────────────┘  │
├──────────────────────────────┴──────────────────────────────────┤
│ JOURNAL LINES                                                   │
│ ┌───────────────────────────────────────────────────────────┐  │
│ │ Account              │ Description    │ Debit   │ Credit  │  │
│ ├───────────────────────────────────────────────────────────┤  │
│ │ 1100 - Accounts Rec. │ Invoice payment│ 125,000 │         │  │
│ │ 4000 - Sales Revenue │ Product sales  │         │ 108,696 │  │
│ │ 2200 - VAT Payable   │ VAT @ 16%      │         │  16,304 │  │
│ └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│ RELATED DOCUMENTS                                               │
│ [🧾 Invoice INV-2025-0042] [📦 Stock Movement STK-0089]        │
├─────────────────────────────────────────────────────────────────┤
│ AUDIT TRAIL                                                     │
│ • Created: Jan 15, 2025 10:30 AM by John Doe                   │
│ • Posted: Jan 15, 2025 11:00 AM by Jane Smith                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Actions by Status
| Status   | Available Actions                    |
|----------|--------------------------------------|
| Draft    | Edit, Post, Delete                   |
| Posted   | Reverse, View Reversal               |
| Reversed | View Original, View Reversal Entry   |

---

## Phase 3: Filtering & Search System

### 3.1 Filter Options
- **Date Range**: Quick presets (Today, This Week, This Month, This Quarter, This Year, Custom)
- **Fiscal Period**: Dropdown of available periods
- **Entry Type**: Multi-select with icons (Sale, Purchase, Payment, etc.)
- **Status**: Draft, Posted, Reversed
- **Account**: Searchable account selector
- **Party**: Customer/Supplier selector
- **Amount Range**: Min/Max inputs

### 3.2 Search
- Real-time search with debounce
- Searches: entry number, description, reference, party name
- Highlight matches in results

### 3.3 Filter Persistence
- Save filters to URL params (shareable links)
- Remember last used filters per user

---

## Phase 4: Visual Design System

### 4.1 Entry Type Icons & Colors
| Type               | Icon | Color   |
|--------------------|------|---------|
| Sale/Invoice       | 🧾   | Blue    |
| Purchase/Bill      | 📥   | Orange  |
| Payment Received   | 💰   | Green   |
| Payment Made       | 💸   | Red     |
| Expense            | 📋   | Purple  |
| Adjustment         | ⚙️   | Gray    |
| Opening Balance    | 📊   | Teal    |
| Advance            | 👤   | Indigo  |
| Transfer           | 🔄   | Cyan    |
| Reversal           | ↩️   | Pink    |
| Manual Entry       | ✏️   | Slate   |

### 4.2 Status Badges
- **Draft**: Yellow/Amber background, "Draft" text
- **Posted**: Green background, "Posted" text
- **Reversed**: Red/Pink background with strikethrough style

### 4.3 Debit/Credit Visualization
```
Debit:  ████████████████░░░░  80,000
Credit: ████████████████████  100,000
```
- Proportional bars showing relative amounts
- Green for credits, Blue for debits
- Helps quickly spot imbalanced entries

---

## Phase 5: Mobile-First Design

### 5.1 Responsive Breakpoints
| Breakpoint | View Behavior |
|------------|---------------|
| Mobile (<640px) | Timeline only, bottom sheet filters, FAB for new entry |
| Tablet (640-1024px) | Timeline + compact table toggle, slide-over filters |
| Desktop (>1024px) | All 3 views, inline filters, full feature set |

### 5.2 Mobile-Specific UI Patterns

#### Filter Bar → Bottom Sheet
```
┌─────────────────────────────────┐
│ 🔍 Search    [Filter ⚙️] [≡]   │  ← Sticky header
├─────────────────────────────────┤
│                                 │
│   Timeline Content              │
│                                 │
└─────────────────────────────────┘
         ↓ Tap Filter
┌─────────────────────────────────┐
│ ━━━━━━━━━━━━━                   │  ← Drag handle
│ Filters                    Done │
├─────────────────────────────────┤
│ Period      [This Month ▼]      │
│ Status      [All ▼]             │
│ Type        [All ▼]             │
│                                 │
│ [Clear All]      [Apply (23)]   │
└─────────────────────────────────┘
```

#### Timeline Cards → Compact Mobile Cards
```
Desktop Card:
┌────────────────────────────────────────────────────┐
│ 🧾 JRN-2025-0234              Jan 15, 10:30 AM    │
│ Invoice Payment - ABC Corp                         │
│ ┌────────────────────────────────────────────┐    │
│ │ Cash           ████████████  125,000  DR  │    │
│ │ Receivables    ████████████  125,000  CR  │    │
│ └────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────┘

Mobile Card (compact):
┌──────────────────────────────────┐
│ 🧾 JRN-2025-0234    [Posted ✓]  │
│ Invoice Payment                  │
│ ABC Corp • Jan 15                │
├──────────────────────────────────┤
│ DR 125,000      CR 125,000      │
│ ████████████    ████████████    │
└──────────────────────────────────┘
      ↓ Tap to expand
┌──────────────────────────────────┐
│ 🧾 JRN-2025-0234    [Posted ✓]  │
│ Invoice Payment                  │
│ ABC Corp • Jan 15, 10:30 AM     │
├──────────────────────────────────┤
│ Cash              125,000  DR   │
│ Receivables       125,000  CR   │
├──────────────────────────────────┤
│ [View Details]    [⋮ Actions]   │
└──────────────────────────────────┘
```

#### Table View → Card List on Mobile
On mobile, table view automatically switches to stacked cards with key info.

#### Floating Action Button (FAB)
```
                    ┌─────┐
                    │  +  │  ← New Entry FAB
                    └─────┘
```

### 5.3 Touch Interactions
- **Swipe Right**: Quick view entry details
- **Swipe Left**: Show actions (Post, Reverse, Delete)
- **Long Press**: Select for bulk actions
- **Pull Down**: Refresh data

### 5.4 Mobile Stats Cards
Stack 2x2 on mobile instead of 4 horizontal:
```
┌─────────┐ ┌─────────┐
│ Total   │ │ This    │
│ 12,450  │ │ Month   │
└─────────┘ └─────────┘
┌─────────┐ ┌─────────┐
│ Drafts  │ │Reversals│
│   5     │ │    2    │
└─────────┘ └─────────┘
```

### 5.5 Mobile Navigation
- Sticky header with back button
- Bottom tab bar integration (if app uses it)
- Breadcrumbs collapse to back arrow on mobile

---

## Phase 6: Performance Optimization

### 5.1 Data Fetching Strategy
- Cursor-based pagination (not offset)
- Initial load: 20 entries
- Infinite scroll or "Load More" button
- Prefetch next page on scroll near bottom

### 5.2 Caching
- Cache filter options (accounts, fiscal periods)
- SWR/React Query for data fetching
- Optimistic updates for status changes

### 5.3 Indexes (Already Exist)
- `{ companyId: 1, entryDate: -1 }`
- `{ companyId: 1, status: 1 }`
- `{ companyId: 1, entryType: 1 }`

---

## File Structure
```
app/dashboard/journal/
├── page.tsx                    # Main journal browser
├── [id]/
│   └── page.tsx               # Journal entry detail
├── create/
│   └── page.tsx               # Create new entry (future)
├── components/
│   ├── JournalStatsCards.tsx
│   ├── JournalFilterBar.tsx
│   ├── JournalViewToggle.tsx
│   ├── JournalTimeline.tsx
│   ├── JournalGroupedView.tsx
│   ├── JournalTable.tsx
│   ├── JournalEntryCard.tsx
│   ├── JournalEntryRow.tsx
│   ├── DebitCreditBar.tsx
│   ├── EntryTypeBadge.tsx
│   ├── StatusBadge.tsx
│   └── JournalActions.tsx
└── loading.tsx                 # Skeleton loader

app/mongodb/queries/
└── journalQueries.js          # Already exists, may need additions
```

---

## Implementation Order

### Sprint 1: Foundation (This Session)
1. ✅ Create `/dashboard/journal/page.tsx` with basic structure
2. ✅ Build `JournalStatsCards.tsx`
3. ✅ Build `JournalFilterBar.tsx` (basic version)
4. ✅ Build `JournalTimeline.tsx` with `JournalEntryCard.tsx`
5. ✅ Add query for timeline data with filters

### Sprint 2: Views & Detail
1. Build `JournalTable.tsx` view
2. Build `JournalGroupedView.tsx`
3. Create `/dashboard/journal/[id]/page.tsx` detail page
4. Add navigation links between list and detail

### Sprint 3: Polish & Actions
1. Add entry actions (post, reverse dialogs)
2. Add export functionality
3. Add keyboard shortcuts
4. Mobile responsive optimization

### Sprint 4: Reports (Future)
1. General Ledger viewer
2. Aging Reports UI
3. Statement of Account UI

---

## Queries Needed

### For Stats Cards
```javascript
// Get journal stats for current month
getJournalStats(fiscalPeriodId) {
  return aggregate([
    { $match: { companyId, fiscalPeriodId } },
    { $group: {
      _id: '$status',
      count: { $sum: 1 },
      totalDebits: { $sum: '$totalDebits' }
    }}
  ])
}
```

### For Timeline (with cursor pagination)
```javascript
getJournalTimeline({ cursor, limit, filters }) {
  const query = { companyId, ...filters };
  if (cursor) query._id = { $lt: cursor };

  return JournalEntry
    .find(query)
    .sort({ entryDate: -1, _id: -1 })
    .limit(limit)
    .lean();
}
```

---

---

## Responsive Component Strategy

### Components with Mobile Variants
| Component | Desktop | Mobile |
|-----------|---------|--------|
| `JournalFilterBar` | Inline dropdowns | Bottom sheet |
| `JournalStatsCards` | 4 horizontal | 2x2 grid |
| `JournalEntryCard` | Full detail | Compact + expandable |
| `JournalTable` | Full table | Card list |
| `JournalActions` | Button group | Action sheet |
| `ViewToggle` | 3 tabs | 2 tabs (no table) or menu |

### Tailwind Breakpoint Usage
```tsx
// Example responsive pattern
<div className="
  grid grid-cols-2 gap-3           // Mobile: 2 columns
  sm:grid-cols-4 sm:gap-4          // Tablet+: 4 columns
">
  {statsCards}
</div>

// Hide on mobile, show on desktop
<div className="hidden sm:block">
  <JournalTable />
</div>

// Show on mobile, hide on desktop
<div className="sm:hidden">
  <JournalCardList />
</div>
```

### Touch Target Sizes
- Minimum 44x44px for all interactive elements
- Adequate spacing between tappable items
- Larger hit areas for swipe actions

---

## Ready to Execute?
This plan provides a comprehensive roadmap with mobile-first design. We'll start with Sprint 1 to build the core journal browser with the engaging Timeline view that works beautifully on all devices.
