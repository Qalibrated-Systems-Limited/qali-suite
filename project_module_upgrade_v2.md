# Project Module — Enterprise Upgrade (v2)

## Status Legend
- ✅ Done
- 🔧 In progress / partial
- ⬜ Not started

---

# 🧠 OVERVIEW

This upgrade transforms the module from:

Financial Project Tracking System  
➡️ into  
Full Project Execution + Financial Control System

---

# 🧱 Phase 1 — Core (Existing Foundation) ✅

✔ Project  
✔ Budget (versioned, GL-linked)  
✔ Cost Codes  
✔ Financial aggregation (revenue, cost, committed)  
✔ Multi-module integration (Invoice, Bill, Expense, Claims, Stock)

---

# 🔥 Phase 2 — Execution Layer (CRITICAL UPGRADE) ⬜

## Task / WBS System

tasks
- projectId
- parentTaskId
- title
- status (todo, in_progress, blocked, done)
- assignedTo
- estimatedHours
- actualHours
- progressPercent

---

## Milestones

milestones
- projectId
- name
- dueDate
- amount
- status

---

## Timesheets

timesheets
- projectId
- taskId
- userId
- hours
- rate
- cost

---

# ⚙️ Phase 3 — Operational Layer ⬜

project_assets
- projectId
- deviceId
- type
- installationStatus
- lastSeenAt

asset_logs
- assetId
- eventType
- timestamp

---

# 🛒 Phase 4 — Procurement ⬜

purchase_requests
- projectId
- taskId
- items

purchase_orders
- projectId
- vendorId
- items
- totalAmount

---

# 📦 Phase 5 — Inventory ⬜

inventory_movements
- projectId
- taskId
- cost

---

# 💰 Phase 6 — Financial Enhancements ⬜

- Parent project rollup
- Earned value (optional)

---

# 🔁 Phase 7 — Change Management ⬜

change_orders
- projectId
- costImpact
- timeImpact
- status

---

# 🧾 Phase 8 — Billing ⬜

- Milestone billing
- Time & material billing

---

# 📊 Phase 9 — Dashboard ⬜

- Task progress
- Budget vs actual
- Device status

---

# 🔐 Phase 10 — Permissions ⬜

- Project-level roles

---

# 🧠 Phase 11 — Automation ⬜

automation_rules
- trigger
- condition
- action

---

# 📎 Phase 12 — Documents ⬜

project_documents
- projectId
- fileUrl

---

# 🚀 FINAL GOAL

- Tasks drive execution  
- Devices confirm progress  
- Costs update automatically  
- Billing reflects actual work  
