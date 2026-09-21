/**
 * The QSL technical report catalogue.
 *
 * Originally ported verbatim from the standalone Workflow Reports app (the
 * eight weighbridge / site sheets WB01–WB06, SI01, TR01), it now spans every
 * project type QSL technicians work on — weighing & metrology, construction,
 * civil engineering, mechanical & electrical maintenance, QA/QC inspection and
 * site HSE. Each sheet is a declarative template rendered by SheetFormFields
 * (capture) and SheetDataView (read-back); adding a sheet needs no schema
 * change because the stored `type` column is free text and the serial counter
 * (`next_entry_number`) creates itself on first use — so a brand-new code like
 * "CN01" simply starts numbering QSL-CN01-00001.
 *
 * Every template carries a `category` so the "new report" picker can group the
 * sheets by the kind of project the technician is on.
 *
 * Section types: `fields`, `textarea`, `checklist` (yes/no labels or an explicit
 * `states` set), `choices` (radio / multi / dropdown), `weekly` (the
 * End–Middle–End test), `loadcells`, and `rows` (a small grid). Only these are
 * rendered — new sheets must use them.
 */

// ── Result-state sets for engineer / inspector checklists ────────────────────
const OK_ATTN_NA = [
  { key: "ok", label: "OK" },
  { key: "attn", label: "ATTN" },
  { key: "na", label: "N/A" },
];
const PASS_ADJ_FAIL = [
  { key: "pass", label: "PASS" },
  { key: "adj", label: "ADJ" },
  { key: "fail", label: "FAIL" },
];
const PASS_FAIL = [
  { key: "pass", label: "PASS" },
  { key: "fail", label: "FAIL" },
];
// Accept/Reject and Conform/Defect reuse the pass/fail colour keys.
const ACCEPT_REJECT = [
  { key: "pass", label: "ACCEPT" },
  { key: "fail", label: "REJECT" },
];
const CONFORM_DEFECT_NA = [
  { key: "pass", label: "CONFORM" },
  { key: "fail", label: "DEFECT" },
  { key: "na", label: "N/A" },
];

// Category order shown in the picker.
export const CATEGORY_ORDER = [
  "Weighing & Metrology",
  "Construction",
  "Civil Engineering",
  "Mechanical Maintenance",
  "Electrical",
  "Inspection & QA/QC",
  "HSE & Safety",
  "Field Service & General",
];

export const TEMPLATES = [
  // ══════════════════════════════════════════════════════════════════════════
  // WEIGHING & METROLOGY
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: "WB01",
    name: "Daily Site Check",
    category: "Weighing & Metrology",
    who: "Site Technician",
    desc: "Quick morning walk-around. Mark each line OK or report a problem.",
    sections: [
      {
        type: "checklist",
        title: "Walk around and check",
        items: [
          "Deck top is clean - no mud, stones or rubbish",
          "Gaps around the deck are clear - nothing stuck inside",
          "Under the deck: no rubbish, no water",
          "Rubber seals (T-seals) in place; nothing trapped behind",
          "Nothing touching or blocking the load cells",
          "Rain water drains away - no standing water",
          "No broken parts: deck, ramps, rails, bumpers",
          "Cables look OK - not cut, not chewed by rats",
          "Screen shows 0 when the deck is empty",
          "Printer works and has paper",
        ],
      },
      { type: "textarea", k: "notes", label: "Anything else you saw today" },
    ],
  },
  {
    code: "WB02",
    name: "Weekly Accuracy Check",
    category: "Weighing & Metrology",
    who: "Site Technician",
    desc: "End-Middle-End test with the same loaded truck.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "truck", label: "Truck used (reg. no.)" },
          { k: "truckWeight", label: "Truck weight (about, kg)", inputType: "number" },
          { k: "limit", label: "Limit for this weighbridge (kg) - ask supervisor", inputType: "number" },
        ],
      },
      { type: "weekly" },
      {
        type: "checklist",
        title: "Zero check",
        yes: "YES",
        no: "NO",
        items: [
          "Screen shows 0 every time the truck drives off",
          "Screen stays at 0 with the deck empty (5 minutes)",
        ],
      },
    ],
  },
  {
    code: "WB03",
    name: "Monthly Maintenance",
    category: "Weighing & Metrology",
    who: "Site Technician",
    desc: "Cleaning and inspection. Never spray water at load cells or the junction box.",
    sections: [
      {
        type: "checklist",
        title: "Cleaning",
        yes: "DONE",
        no: "NO",
        items: [
          "Washed the deck top - removed mud, stones, spillage",
          "Cleared under the deck (water kept away from load cells / junction box)",
          "Cleared gaps, rubber seals and drains",
        ],
      },
      {
        type: "checklist",
        title: "Look and check",
        items: [
          "Deck has not moved or shifted",
          "Bolts tight - none loose or missing",
          "No cracks, bends or heavy rust",
          "Cables OK all along - no cuts, no rat damage",
          "Junction box closed, dry, not damaged",
          "Earth wire (lightning wire) connected",
        ],
      },
      {
        type: "checklist",
        title: "Do",
        yes: "DONE",
        no: "NO",
        items: [
          "Pressed ZERO with deck empty and clean",
          "Did the weekly accuracy test (submit WB02 too)",
          "Compared with last month - told supervisor of changes",
        ],
      },
      { type: "textarea", k: "notes", label: "Anything else you saw this month" },
    ],
  },
  {
    code: "WB04",
    name: "Engineer Service Checklist",
    category: "Weighing & Metrology",
    who: "QSL Engineer",
    desc: "Quarterly / bi-annual service inspection (QSL/F/WB-04).",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "serviceDate", label: "Service date", inputType: "date" },
          { k: "make", label: "Make / model" },
          { k: "serialNo", label: "Serial no." },
          { k: "capacity", label: "Capacity / division" },
          { k: "deckLength", label: "Deck length" },
          { k: "jobRef", label: "Job / contract ref." },
        ],
      },
      {
        type: "checklist",
        title: "As-found condition",
        states: OK_ATTN_NA,
        items: [
          "Deck, foundation and approaches inspected; defects recorded",
          "Deck free-moving; expansion gaps and check-rod clearances correct",
          "Load cell mountings, links and bases seated and secure",
          "Junction box dry, terminations tight; cable insulation resistance acceptable",
          "Indicator diagnostics reviewed; error log recorded",
          "Surge / lightning protection devices intact; earthing secure",
        ],
      },
      { type: "loadcells" },
      {
        type: "checklist",
        title: "Performance tests (record details on QSL/F/WB-06)",
        states: PASS_ADJ_FAIL,
        items: [
          "Eccentricity / corner test with certified test weights",
          "Increasing-load (linearity) test to service capacity",
          "Repeatability and return-to-zero within tolerance",
          "Calibration adjusted as required; as-left results recorded",
          "W&M verification stamp valid (expiry in remarks); indicator sealing intact",
        ],
      },
      { type: "textarea", k: "remarks", label: "Engineer remarks / recommendations" },
    ],
  },
  {
    code: "WB05",
    name: "Weighbridge Service Report",
    category: "Weighing & Metrology",
    who: "QSL Engineer",
    desc: "Corrective / breakdown visit (QSL/F/WB-05): fault, diagnosis, work, parts.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "make", label: "Make / model" },
          { k: "serialNo", label: "Serial no." },
          { k: "reportNo", label: "Report no." },
          { k: "callLogged", label: "Call logged (date/time)" },
          { k: "arrival", label: "Arrival (date/time)" },
          { k: "dateOfVisit", label: "Date of visit", inputType: "date" },
        ],
      },
      { type: "textarea", k: "fault", label: "Fault reported by site" },
      { type: "textarea", k: "diagnosis", label: "Diagnosis / findings" },
      { type: "textarea", k: "work", label: "Work carried out" },
      {
        type: "rows",
        key: "parts",
        title: "Parts supplied / replaced",
        cols: ["Qty", "Description", "Part no.", "Warranty / charge"],
        rows: 6,
      },
      {
        type: "choices",
        k: "outcome",
        title: "Status when leaving site",
        options: [
          "Back in service - accuracy checked",
          "Back in service - calibration recommended",
          "Out of service - parts on order",
          "Out of service - repair quoted",
        ],
      },
      {
        type: "fields",
        fields: [{ k: "numPhotos", label: "Number of photos attached", inputType: "number" }],
      },
      { type: "textarea", k: "recs", label: "Recommendations to the client" },
    ],
  },
  {
    code: "WB06",
    name: "Calibration & Verification Record",
    category: "Weighing & Metrology",
    who: "QSL Engineer",
    desc: "ISO/IEC 17025 calibration with traceable test weights (QSL/F/WB-06).",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "certNo", label: "Certificate no." },
          { k: "make", label: "Make / model" },
          { k: "serialNo", label: "Weighbridge serial no." },
          { k: "capacity", label: "Capacity / division" },
          { k: "calibrationDate", label: "Calibration date", inputType: "date" },
          { k: "weights", label: "Test weight IDs" },
          { k: "trace", label: "Traceability cert. no." },
        ],
      },
      {
        type: "rows",
        key: "incr",
        title: "Increasing load test",
        cols: ["Applied (kg)", "As-found (kg)", "As-left (kg)", "Error (kg)", "Tolerance / Pass"],
        rows: 5,
      },
      {
        type: "rows",
        key: "ecc",
        title: "Eccentricity (corner) test",
        cols: ["Position", "Applied (kg)", "Reading (kg)", "Error (kg)"],
        rows: 4,
        prefill: [["End A"], ["Centre"], ["End B"], ["Sides (L/R)"]],
      },
      {
        type: "fields",
        fields: [
          { k: "repeatReadings", label: "Repeat readings, same load (kg)" },
          { k: "maxSpread", label: "Repeatability - max spread (kg)", inputType: "number" },
          { k: "returnZero", label: "Return to zero (kg)", inputType: "number" },
          { k: "nextDue", label: "Next calibration due", inputType: "date" },
          { k: "stampExpiry", label: "Verification stamp expiry", inputType: "date" },
        ],
      },
      {
        type: "choices",
        k: "outcome",
        title: "Outcome",
        dropdown: true,
        options: ["Certificate issued", "Certificate not issued", "Pending"],
      },
    ],
  },
  {
    code: "WB07",
    name: "Bench / Platform Scale Verification",
    category: "Weighing & Metrology",
    who: "QSL Engineer",
    desc: "Retail, bench or platform scale check with certified test weights.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "make", label: "Make / model" },
          { k: "serialNo", label: "Serial no." },
          { k: "capacity", label: "Max capacity" },
          { k: "division", label: "Division (e)" },
          { k: "class", label: "Accuracy class" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "points",
        title: "Test points",
        cols: ["Nominal (kg)", "Reading (kg)", "Error", "MPE", "Pass?"],
        rows: 5,
      },
      {
        type: "checklist",
        title: "Checks",
        states: PASS_FAIL,
        items: [
          "Zero and tare function correctly",
          "Eccentricity (off-centre) within tolerance",
          "Repeatability within tolerance",
          "Display / print clear and stable",
          "Verification seal intact",
        ],
      },
      {
        type: "choices",
        k: "outcome",
        title: "Outcome",
        dropdown: true,
        options: ["Verified - pass", "Adjusted - now pass", "Failed - rejected"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "WB08",
    name: "Axle Weigh-Pad Check",
    category: "Weighing & Metrology",
    who: "Site Technician",
    desc: "Portable axle / wheel weigh-pad accuracy and condition check.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "padIds", label: "Pad IDs used" },
          { k: "refWeight", label: "Reference load (kg)", inputType: "number" },
          { k: "surface", label: "Ground surface / level" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Condition",
        items: [
          "Pads clean, undamaged, no cracks",
          "Cables and connectors intact",
          "Batteries charged; indicator powers up",
          "Set-up on firm, level ground",
        ],
      },
      {
        type: "rows",
        key: "compare",
        title: "Comparison against reference",
        cols: ["Axle / point", "Pad reading (kg)", "Reference (kg)", "Difference"],
        rows: 4,
      },
      { type: "textarea", k: "notes", label: "Notes" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CALIBRATION & METROLOGY (instruments other than weighing)
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: "CB01",
    name: "Pressure Gauge Calibration",
    category: "Weighing & Metrology",
    who: "Calibration Technician",
    desc: "Calibrate a pressure gauge / transmitter against a traceable reference.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "tagNo", label: "Instrument tag / ID" },
          { k: "make", label: "Make / model" },
          { k: "range", label: "Range & unit" },
          { k: "refStd", label: "Reference standard (cert no.)" },
          { k: "date", label: "Calibration date", inputType: "date" },
          { k: "nextDue", label: "Next due", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "points",
        title: "As-found / as-left readings",
        cols: ["Applied", "As-found", "As-left", "Error", "Tolerance", "Pass?"],
        rows: 6,
        prefill: [["0%"], ["25%"], ["50%"], ["75%"], ["100%"]],
      },
      {
        type: "choices",
        k: "outcome",
        title: "Result",
        dropdown: true,
        options: ["Pass - within tolerance", "Adjusted - now passes", "Fail - out of tolerance", "Rejected / withdrawn"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "CB02",
    name: "Temperature Instrument Calibration",
    category: "Weighing & Metrology",
    who: "Calibration Technician",
    desc: "Thermometer, thermocouple or RTD loop calibration against a reference.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "tagNo", label: "Instrument tag / ID" },
          { k: "type", label: "Sensor type (K/J/PT100…)" },
          { k: "range", label: "Range & unit" },
          { k: "refStd", label: "Reference standard (cert no.)" },
          { k: "medium", label: "Medium (bath / dry-block)" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "points",
        title: "Readings",
        cols: ["Set point", "Reference", "UUT reading", "Error", "Tolerance", "Pass?"],
        rows: 5,
      },
      {
        type: "choices",
        k: "outcome",
        title: "Result",
        dropdown: true,
        options: ["Pass", "Adjusted - now passes", "Fail"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "CB03",
    name: "Torque Tool Calibration",
    category: "Weighing & Metrology",
    who: "Calibration Technician",
    desc: "Torque wrench / driver calibration against a traceable torque analyser.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "toolId", label: "Tool ID" },
          { k: "make", label: "Make / model" },
          { k: "range", label: "Range & unit (Nm)" },
          { k: "analyser", label: "Torque analyser (cert no.)" },
          { k: "date", label: "Date", inputType: "date" },
          { k: "nextDue", label: "Next due", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "points",
        title: "Test points (mean of readings)",
        cols: ["Target", "Reading 1", "Reading 2", "Reading 3", "Mean", "Error %", "Pass?"],
        rows: 3,
        prefill: [["20% FS"], ["60% FS"], ["100% FS"]],
      },
      {
        type: "choices",
        k: "outcome",
        title: "Result",
        options: ["Pass", "Adjusted - now passes", "Fail"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "CB04",
    name: "Dimensional Instrument Calibration",
    category: "Weighing & Metrology",
    who: "Calibration Technician",
    desc: "Caliper, micrometer or gauge check against slip gauges / reference bars.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "toolId", label: "Instrument ID" },
          { k: "type", label: "Type (caliper / micrometer…)" },
          { k: "range", label: "Range & resolution" },
          { k: "refStd", label: "Reference (slip-gauge set no.)" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "points",
        title: "Readings",
        cols: ["Nominal (mm)", "Reading (mm)", "Error", "Tolerance", "Pass?"],
        rows: 5,
      },
      {
        type: "checklist",
        title: "Condition",
        states: PASS_FAIL,
        items: ["Measuring faces undamaged", "Zero / reference set correct", "Locking and movement smooth"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTION
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: "SI01",
    name: "Site Instruction",
    category: "Construction",
    who: "Consultant / Site Engineer",
    desc: "Formal construction site instruction: contract details, the instruction itself, cost code and approvals.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "project", label: "Project" },
          { k: "contractor", label: "Contractor" },
          { k: "scope", label: "Scope / description" },
          { k: "instructionDate", label: "Date of instruction", inputType: "date" },
          { k: "costCode", label: "Cost code" },
        ],
      },
      {
        type: "textarea",
        k: "details",
        label: "Site instruction details (attach a separate schedule if space is insufficient)",
      },
      {
        type: "checklist",
        title: "Instruction terms",
        yes: "CONFIRMED",
        no: "NOT YET",
        items: [
          "This instruction is deemed to be included in the contract works",
          "No further works to proceed until the site instructions are fully executed and approved",
        ],
      },
    ],
  },
  {
    code: "CN01",
    name: "Concrete Pour Record",
    category: "Construction",
    who: "Site Engineer",
    desc: "Pre-pour approval and concrete placement record for a structural element.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "element", label: "Element (e.g. Column C4, GF slab)" },
          { k: "grade", label: "Concrete grade (e.g. C25/30)" },
          { k: "gridRef", label: "Grid / location ref." },
          { k: "supplier", label: "Supplier / batching plant" },
          { k: "volume", label: "Volume placed (m³)", inputType: "number" },
          { k: "pourDate", label: "Pour date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Pre-pour checks (must all be YES before pouring)",
        yes: "YES",
        no: "NO",
        items: [
          "Reinforcement fixed, tied and inspected (CN03 approved)",
          "Formwork clean, tight, aligned and oiled (CN04 approved)",
          "Cover blocks / spacers in place to correct cover",
          "Cast-in items, sleeves and starter bars positioned",
          "Setting-out and levels checked",
          "Consultant / clerk of works approval to pour obtained",
        ],
      },
      {
        type: "fields",
        fields: [
          { k: "slump", label: "Slump (mm)", inputType: "number" },
          { k: "temp", label: "Concrete temp (°C)", inputType: "number" },
          { k: "cubes", label: "No. of cubes taken", inputType: "number" },
          { k: "cubeIds", label: "Cube reference IDs" },
        ],
      },
      { type: "textarea", k: "notes", label: "Curing method / weather / observations" },
    ],
  },
  {
    code: "CN02",
    name: "Concrete Cube Compressive Test",
    category: "Construction",
    who: "Materials Technician",
    desc: "Crushing test results for concrete cube samples.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "element", label: "Element / pour ref. (link CN01)" },
          { k: "grade", label: "Design grade" },
          { k: "castDate", label: "Cast date", inputType: "date" },
          { k: "testDate", label: "Test date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "cubes",
        title: "Cube results",
        cols: ["Cube ID", "Age (days)", "Mass (kg)", "Load (kN)", "Strength (MPa)", "Pass?"],
        rows: 6,
      },
      {
        type: "choices",
        k: "outcome",
        title: "Result vs characteristic strength",
        options: ["Pass - meets grade", "Fail - below grade (raise NCR)"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "CN03",
    name: "Reinforcement (Rebar) Inspection",
    category: "Construction",
    who: "Site Engineer",
    desc: "Check steel reinforcement before formwork closes / before pour.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "element", label: "Element" },
          { k: "drawingRef", label: "Drawing / bar bending ref." },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Reinforcement checks",
        states: CONFORM_DEFECT_NA,
        items: [
          "Bar sizes as per drawing / bending schedule",
          "Bar spacing correct",
          "Laps and anchorage lengths correct",
          "Cover to reinforcement correct (spacers fitted)",
          "Bars clean - free of loose rust, oil, mud",
          "Links / stirrups fixed and tied",
          "Starter bars and couplers correct",
        ],
      },
      { type: "textarea", k: "defects", label: "Defects noted / action required" },
      {
        type: "choices",
        k: "outcome",
        title: "Inspection outcome",
        options: ["Approved to proceed", "Approved with comments", "Rejected - re-inspect"],
      },
    ],
  },
  {
    code: "CN04",
    name: "Formwork & Falsework Inspection",
    category: "Construction",
    who: "Site Engineer",
    desc: "Check formwork and its supports are safe and correct before pouring.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "element", label: "Element" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Formwork & falsework",
        states: PASS_FAIL,
        items: [
          "Dimensions, line and level correct",
          "Formwork tight - no gaps / grout loss",
          "Props / falsework plumb, braced and on firm bearing",
          "Props spacing per design; base plates and sole boards used",
          "Release agent applied; surface clean",
          "Access and working platforms safe",
        ],
      },
      { type: "textarea", k: "notes", label: "Notes / corrective action" },
      {
        type: "choices",
        k: "outcome",
        title: "Outcome",
        options: ["Approved to load / pour", "Rejected - rectify and re-inspect"],
      },
    ],
  },
  {
    code: "CN05",
    name: "Site Daily Diary / Progress",
    category: "Construction",
    who: "Site Agent / Foreman",
    desc: "Daily record of weather, labour, plant and work done on site.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "date", label: "Date", inputType: "date" },
          { k: "weather", label: "Weather" },
          { k: "labourCount", label: "Total labour on site", inputType: "number" },
        ],
      },
      {
        type: "rows",
        key: "labour",
        title: "Labour",
        cols: ["Trade / gang", "No.", "Hours"],
        rows: 5,
      },
      {
        type: "rows",
        key: "plant",
        title: "Plant & equipment",
        cols: ["Item", "No.", "Working / idle", "Hours"],
        rows: 5,
      },
      { type: "textarea", k: "workDone", label: "Work carried out today" },
      { type: "textarea", k: "delays", label: "Delays / stoppages / instructions received" },
      { type: "textarea", k: "visitors", label: "Visitors / deliveries" },
    ],
  },
  {
    code: "CN06",
    name: "Material Delivery & Inspection",
    category: "Construction",
    who: "Storekeeper / Site Engineer",
    desc: "Receive and inspect materials delivered to site against the order.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "supplier", label: "Supplier" },
          { k: "dnNo", label: "Delivery note no." },
          { k: "poNo", label: "Purchase order no." },
          { k: "date", label: "Delivery date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "items",
        title: "Items received",
        cols: ["Material", "Qty ordered", "Qty received", "Unit", "Accept / reject"],
        rows: 6,
      },
      {
        type: "checklist",
        title: "Inspection",
        states: ACCEPT_REJECT,
        items: [
          "Quantity matches delivery note",
          "No damage / breakage",
          "Certificates / test data supplied where required",
          "Correct grade / specification",
        ],
      },
      { type: "textarea", k: "discrepancies", label: "Discrepancies / rejected items" },
    ],
  },
  {
    code: "CN07",
    name: "Snag / Punch List",
    category: "Construction",
    who: "Site Engineer / Consultant",
    desc: "Defects list at handover with responsibility and close-out.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "area", label: "Area / building / floor" },
          { k: "inspectionDate", label: "Inspection date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "snags",
        title: "Snags",
        cols: ["#", "Location", "Description of defect", "Responsible", "Target date", "Status"],
        rows: 10,
      },
      { type: "textarea", k: "notes", label: "General notes" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CIVIL ENGINEERING
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: "CE01",
    name: "Earthworks Compaction (Field Density) Test",
    category: "Civil Engineering",
    who: "Materials / Geotech Technician",
    desc: "In-situ density vs proctor MDD for a compacted fill / subgrade layer.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "location", label: "Location / chainage" },
          { k: "layer", label: "Layer (e.g. subgrade, sub-base)" },
          { k: "material", label: "Material description" },
          { k: "method", label: "Method (sand-cone / nuclear)" },
          { k: "mdd", label: "Lab MDD (kg/m³)", inputType: "number" },
          { k: "omc", label: "OMC (%)", inputType: "number" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "tests",
        title: "Test points",
        cols: ["Point", "Field density", "Moisture %", "Compaction %", "Spec %", "Pass?"],
        rows: 5,
      },
      {
        type: "choices",
        k: "outcome",
        title: "Result",
        options: ["Pass - meets specified compaction", "Fail - re-compact and re-test"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "CE02",
    name: "Trial Pit / Borehole Log",
    category: "Civil Engineering",
    who: "Geotech Technician",
    desc: "Strata log from a trial pit or borehole with samples and water strikes.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "holeId", label: "Pit / borehole ID" },
          { k: "coords", label: "Coordinates / location" },
          { k: "groundLevel", label: "Ground level (m)" },
          { k: "waterStrike", label: "Water strike depth (m)" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "strata",
        title: "Strata / samples",
        cols: ["From (m)", "To (m)", "Soil description", "Sample no.", "Test"],
        rows: 8,
      },
      { type: "textarea", k: "remarks", label: "Remarks / groundwater notes" },
    ],
  },
  {
    code: "CE03",
    name: "Road Pavement Layer Inspection",
    category: "Civil Engineering",
    who: "Site Engineer",
    desc: "Approve a pavement layer (sub-base, base, surfacing) before the next lift.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "chainage", label: "Chainage from / to" },
          { k: "layer", label: "Layer" },
          { k: "material", label: "Material / mix" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Checks",
        states: PASS_FAIL,
        items: [
          "Thickness within tolerance",
          "Levels and crossfall correct",
          "Compaction test passed (link CE01)",
          "Surface regularity acceptable",
          "Edges and joints formed correctly",
        ],
      },
      { type: "textarea", k: "notes", label: "Notes" },
      {
        type: "choices",
        k: "outcome",
        title: "Outcome",
        options: ["Approved for next layer", "Rejected - rework"],
      },
    ],
  },
  {
    code: "CE04",
    name: "Setting-Out / Survey Check",
    category: "Civil Engineering",
    who: "Surveyor",
    desc: "Independent check of setting-out against control and design.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "element", label: "Element set out" },
          { k: "instrument", label: "Instrument (total station / level)" },
          { k: "benchmark", label: "Benchmark / control ref." },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "points",
        title: "Checked points",
        cols: ["Point", "Design E/N/Z", "Measured E/N/Z", "Difference", "Within tol.?"],
        rows: 6,
      },
      {
        type: "choices",
        k: "outcome",
        title: "Outcome",
        options: ["Setting-out verified", "Corrections required"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "CE05",
    name: "Drainage / Culvert Inspection",
    category: "Civil Engineering",
    who: "Site Engineer",
    desc: "Inspect installed drainage runs, manholes or culverts.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "location", label: "Location / chainage" },
          { k: "type", label: "Type (pipe / box culvert / channel)" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Checks",
        states: PASS_FAIL,
        items: [
          "Invert levels and gradient correct",
          "Bedding and surround as specified",
          "Joints sealed; alignment true",
          "Manholes / chambers to detail",
          "Flow test / water test satisfactory",
          "Backfill and compaction correct",
        ],
      },
      { type: "textarea", k: "notes", label: "Notes / defects" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MECHANICAL MAINTENANCE
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: "MT01",
    name: "Planned Preventive Maintenance (PPM)",
    category: "Mechanical Maintenance",
    who: "Maintenance Technician",
    desc: "Scheduled preventive maintenance service on plant / equipment.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "assetId", label: "Asset / equipment ID" },
          { k: "assetName", label: "Equipment name" },
          { k: "location", label: "Location" },
          { k: "runHours", label: "Running hours / meter", inputType: "number" },
          { k: "date", label: "Service date", inputType: "date" },
          { k: "nextDue", label: "Next service due", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Service tasks",
        yes: "DONE",
        no: "N/A",
        items: [
          "Visual inspection - leaks, damage, corrosion",
          "Lubrication / greasing carried out",
          "Filters checked / replaced",
          "Fluid levels checked and topped up",
          "Belts, chains, couplings checked / tensioned",
          "Fasteners checked for tightness",
          "Guards and safety devices operational",
          "Cleaned down after service",
        ],
      },
      {
        type: "checklist",
        title: "Functional test",
        states: PASS_FAIL,
        items: ["Runs smoothly - no abnormal noise / vibration", "Controls and interlocks function", "Temperatures / pressures normal"],
      },
      { type: "textarea", k: "faults", label: "Faults found / parts required" },
    ],
  },
  {
    code: "MT02",
    name: "Breakdown / Corrective Maintenance",
    category: "Mechanical Maintenance",
    who: "Maintenance Technician",
    desc: "Unplanned repair: fault, diagnosis, work done, parts and downtime.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "assetId", label: "Asset / equipment ID" },
          { k: "reportedBy", label: "Reported by" },
          { k: "timeDown", label: "Time down" },
          { k: "timeUp", label: "Time restored" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      { type: "textarea", k: "fault", label: "Fault reported" },
      { type: "textarea", k: "diagnosis", label: "Root cause / diagnosis" },
      { type: "textarea", k: "work", label: "Work carried out" },
      {
        type: "rows",
        key: "parts",
        title: "Parts used",
        cols: ["Qty", "Part / description", "Part no."],
        rows: 5,
      },
      {
        type: "choices",
        k: "outcome",
        title: "Status on leaving",
        options: ["Repaired - back in service", "Temporary fix - monitor", "Awaiting parts", "Referred to specialist"],
      },
    ],
  },
  {
    code: "MT03",
    name: "Pump & Motor Service",
    category: "Mechanical Maintenance",
    who: "Maintenance Technician",
    desc: "Service and performance check of a pump / motor set.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "assetId", label: "Pump / motor ID" },
          { k: "rating", label: "Rating (kW / head / flow)" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Checks",
        states: OK_ATTN_NA,
        items: [
          "Bearings - noise / temperature normal",
          "Mechanical seal / gland - no excess leakage",
          "Alignment and coupling condition",
          "Vibration within limits",
          "Motor current within rating",
          "Insulation resistance acceptable",
        ],
      },
      {
        type: "rows",
        key: "readings",
        title: "Readings",
        cols: ["Parameter", "Value", "Unit"],
        rows: 4,
        prefill: [["Suction pressure"], ["Discharge pressure"], ["Flow"], ["Motor current"]],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "MT04",
    name: "Generator Service Report",
    category: "Mechanical Maintenance",
    who: "Maintenance Technician",
    desc: "Diesel generator preventive service and load check.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "genId", label: "Generator ID" },
          { k: "kva", label: "Rating (kVA)" },
          { k: "runHours", label: "Running hours", inputType: "number" },
          { k: "date", label: "Service date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Service",
        yes: "DONE",
        no: "N/A",
        items: [
          "Engine oil & filter changed",
          "Fuel filter / water separator serviced",
          "Air filter checked / replaced",
          "Coolant level & condition checked",
          "Battery & charging system checked",
          "Belts and hoses inspected",
          "Control panel alarms tested",
        ],
      },
      {
        type: "rows",
        key: "readings",
        title: "On-load readings",
        cols: ["Parameter", "Value", "Unit"],
        rows: 5,
        prefill: [["Voltage L-L"], ["Frequency"], ["Load"], ["Oil pressure"], ["Coolant temp"]],
      },
      { type: "textarea", k: "remarks", label: "Remarks / defects" },
    ],
  },
  {
    code: "MT05",
    name: "HVAC / Refrigeration Service",
    category: "Mechanical Maintenance",
    who: "HVAC Technician",
    desc: "Service of air-conditioning / refrigeration unit.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "unitId", label: "Unit ID / location" },
          { k: "type", label: "Type (split / VRF / chiller)" },
          { k: "refrigerant", label: "Refrigerant" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Service tasks",
        yes: "DONE",
        no: "N/A",
        items: [
          "Filters cleaned / replaced",
          "Coils cleaned (condenser & evaporator)",
          "Condensate drain cleared",
          "Refrigerant pressures / superheat checked",
          "Electrical connections checked",
          "Fan / compressor operation checked",
        ],
      },
      {
        type: "fields",
        fields: [
          { k: "supplyTemp", label: "Supply air temp (°C)", inputType: "number" },
          { k: "returnTemp", label: "Return air temp (°C)", inputType: "number" },
        ],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ELECTRICAL
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: "EL01",
    name: "Electrical Installation Inspection & Test",
    category: "Electrical",
    who: "Electrical Technician",
    desc: "Inspection and test of an electrical installation / distribution board.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "installation", label: "Installation / board ref." },
          { k: "location", label: "Location" },
          { k: "supply", label: "Supply (V / phases)" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Visual inspection",
        states: PASS_FAIL,
        items: [
          "Enclosures / covers secure; no damage",
          "Correct protective devices fitted and rated",
          "Conductors correctly identified and terminated",
          "Earthing and bonding present and secure",
          "Warning labels and schedules present",
        ],
      },
      {
        type: "rows",
        key: "circuits",
        title: "Circuit test results",
        cols: ["Circuit", "IR (MΩ)", "Continuity (Ω)", "Zs (Ω)", "RCD (ms)", "Pass?"],
        rows: 8,
      },
      {
        type: "choices",
        k: "outcome",
        title: "Outcome",
        options: ["Satisfactory", "Unsatisfactory - remedial work required"],
      },
      { type: "textarea", k: "remarks", label: "Observations / remedial actions" },
    ],
  },
  {
    code: "EL02",
    name: "Earthing & Lightning Protection Test",
    category: "Electrical",
    who: "Electrical Technician",
    desc: "Earth resistance and lightning protection continuity test.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "site", label: "Site / structure" },
          { k: "method", label: "Test method / instrument" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "electrodes",
        title: "Earth electrode readings",
        cols: ["Electrode / point", "Resistance (Ω)", "Limit (Ω)", "Pass?"],
        rows: 6,
      },
      {
        type: "checklist",
        title: "Lightning protection",
        states: PASS_FAIL,
        items: ["Air terminals / conductors intact", "Down-conductor continuity OK", "Test clamps / joints secure", "Bonding to services present"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "EL03",
    name: "Solar PV Commissioning",
    category: "Electrical",
    who: "Solar Technician",
    desc: "Commissioning tests for a solar PV / hybrid installation.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "system", label: "System / site" },
          { k: "arraySize", label: "Array size (kWp)", inputType: "number" },
          { k: "inverter", label: "Inverter make / model" },
          { k: "battery", label: "Battery (if any)" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "strings",
        title: "String tests",
        cols: ["String", "Voc (V)", "Isc (A)", "IR (MΩ)", "Polarity", "Pass?"],
        rows: 6,
      },
      {
        type: "checklist",
        title: "Commissioning checks",
        states: PASS_FAIL,
        items: [
          "Array mounting and earthing secure",
          "DC & AC isolation and protection correct",
          "Inverter parameters configured",
          "Anti-islanding / grid settings verified",
          "Monitoring / comms online",
          "Labels and warning signs fitted",
        ],
      },
      { type: "textarea", k: "remarks", label: "Remarks / handover notes" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // INSPECTION & QA/QC
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: "IN01",
    name: "Incoming Material Inspection",
    category: "Inspection & QA/QC",
    who: "QA/QC Inspector",
    desc: "Inspect goods received against specification before acceptance.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "supplier", label: "Supplier" },
          { k: "material", label: "Material / part" },
          { k: "poNo", label: "PO / GRN no." },
          { k: "lotSize", label: "Lot size", inputType: "number" },
          { k: "sampleSize", label: "Sample size", inputType: "number" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "characteristics",
        title: "Characteristics checked",
        cols: ["Characteristic", "Specification", "Actual", "Accept / reject"],
        rows: 6,
      },
      {
        type: "choices",
        k: "outcome",
        title: "Disposition",
        options: ["Accept", "Accept under concession", "Reject / return", "Quarantine (raise NCR)"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "IN02",
    name: "Final Inspection & Test",
    category: "Inspection & QA/QC",
    who: "QA/QC Inspector",
    desc: "Final acceptance inspection of a finished item / assembly before release.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "item", label: "Item / assembly" },
          { k: "drawingRef", label: "Drawing / spec ref." },
          { k: "serialNo", label: "Serial / batch no." },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Inspection",
        states: CONFORM_DEFECT_NA,
        items: [
          "Dimensions within tolerance",
          "Visual / surface finish acceptable",
          "Function / performance test passed",
          "Markings, labels and identification correct",
          "Documentation / certificates complete",
        ],
      },
      {
        type: "choices",
        k: "outcome",
        title: "Result",
        options: ["Passed - released", "Failed - rejected (raise NCR)", "Conditional release"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "IN03",
    name: "Welding Visual Inspection",
    category: "Inspection & QA/QC",
    who: "Welding Inspector",
    desc: "Visual inspection of welded joints against WPS / acceptance criteria.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "jointRef", label: "Joint / weld ref." },
          { k: "wps", label: "WPS no." },
          { k: "welderId", label: "Welder ID" },
          { k: "process", label: "Process (SMAW/GMAW…)" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Visual acceptance",
        states: ACCEPT_REJECT,
        items: [
          "No cracks",
          "No undercut beyond limits",
          "No porosity / surface defects beyond limits",
          "Weld size / profile / reinforcement acceptable",
          "No incomplete fusion / overlap",
          "Cleaning and spatter acceptable",
        ],
      },
      {
        type: "choices",
        k: "ndt",
        title: "Further NDT required?",
        options: ["None", "UT", "RT", "MPI", "DPI"],
        multi: true,
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },
  {
    code: "IN04",
    name: "NDT Report",
    category: "Inspection & QA/QC",
    who: "NDT Technician",
    desc: "Non-destructive testing results (UT / RT / MPI / DPI).",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "item", label: "Item / joint" },
          { k: "technique", label: "Technique" },
          { k: "acceptance", label: "Acceptance standard" },
          { k: "equipment", label: "Equipment / consumables" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "results",
        title: "Results",
        cols: ["Location / weld", "Indication", "Size", "Accept / reject"],
        rows: 8,
      },
      {
        type: "choices",
        k: "outcome",
        title: "Overall result",
        options: ["Accept", "Reject (raise NCR)"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // HSE & SAFETY
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: "HS01",
    name: "Site Safety Inspection",
    category: "HSE & Safety",
    who: "HSE Officer",
    desc: "Routine site safety walk with findings and corrective actions.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "site", label: "Site / area" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Safety checks",
        states: CONFORM_DEFECT_NA,
        items: [
          "Access, egress and walkways clear",
          "Edge protection / barriers to openings & excavations",
          "Scaffolding tagged and safe",
          "PPE worn correctly",
          "Electrical leads / tools safe",
          "Housekeeping and waste control",
          "Fire points & extinguishers in place",
          "First aid & welfare provision",
          "Plant & lifting equipment certified",
        ],
      },
      {
        type: "rows",
        key: "actions",
        title: "Findings & corrective actions",
        cols: ["Finding", "Risk (H/M/L)", "Action", "Responsible", "Target date"],
        rows: 6,
      },
      { type: "textarea", k: "notes", label: "General notes" },
    ],
  },
  {
    code: "HS02",
    name: "Toolbox Talk Record",
    category: "HSE & Safety",
    who: "Supervisor / HSE Officer",
    desc: "Record of a toolbox talk / safety briefing and attendance.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "topic", label: "Topic" },
          { k: "presenter", label: "Presented by" },
          { k: "date", label: "Date", inputType: "date" },
          { k: "attendees", label: "No. of attendees", inputType: "number" },
        ],
      },
      { type: "textarea", k: "keyPoints", label: "Key points covered" },
      {
        type: "rows",
        key: "attendance",
        title: "Attendance",
        cols: ["Name", "Company / trade", "Signature"],
        rows: 10,
      },
    ],
  },
  {
    code: "HS03",
    name: "Incident / Near-Miss Report",
    category: "HSE & Safety",
    who: "Any Employee / HSE Officer",
    desc: "Report an accident, incident or near-miss for investigation.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "location", label: "Location" },
          { k: "dateTime", label: "Date & time of event" },
          { k: "reportedBy", label: "Reported by" },
          { k: "personsInvolved", label: "Persons involved" },
        ],
      },
      {
        type: "choices",
        k: "classification",
        title: "Classification",
        options: ["Near miss", "First aid", "Medical treatment", "Lost time injury", "Property / environmental damage", "Dangerous occurrence"],
      },
      { type: "textarea", k: "description", label: "What happened (sequence of events)" },
      { type: "textarea", k: "immediateAction", label: "Immediate action taken" },
      { type: "textarea", k: "rootCause", label: "Root / underlying cause" },
      { type: "textarea", k: "preventive", label: "Preventive action to stop recurrence" },
    ],
  },
  {
    code: "HS04",
    name: "Risk Assessment (JHA)",
    category: "HSE & Safety",
    who: "Supervisor / HSE Officer",
    desc: "Job hazard analysis: hazards, risk rating and controls for a task.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "activity", label: "Activity / task" },
          { k: "location", label: "Location" },
          { k: "assessedBy", label: "Assessed by" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "rows",
        key: "hazards",
        title: "Hazards & controls",
        cols: ["Hazard", "Who at risk", "Risk (H/M/L)", "Control measures", "Residual risk"],
        rows: 8,
      },
      {
        type: "checklist",
        title: "Controls in place",
        yes: "YES",
        no: "NO",
        items: ["Safe system of work briefed", "PPE specified and available", "Permits obtained where required", "Emergency arrangements in place"],
      },
      { type: "textarea", k: "notes", label: "Notes" },
    ],
  },
  {
    code: "HS05",
    name: "Lifting Equipment Inspection",
    category: "HSE & Safety",
    who: "Competent Person",
    desc: "Pre-use / periodic inspection of cranes, hoists, slings and tackle.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "equipment", label: "Equipment / ID" },
          { k: "swl", label: "SWL / WLL" },
          { k: "certNo", label: "Cert. / exam. ref." },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Inspection",
        states: PASS_FAIL,
        items: [
          "No damage, wear or deformation",
          "Hooks, latches and shackles serviceable",
          "Slings / chains / ropes within discard limits",
          "SWL clearly marked",
          "Certification / colour code current",
          "Controls and limit switches function",
        ],
      },
      {
        type: "choices",
        k: "outcome",
        title: "Result",
        options: ["Fit for use", "Removed from service (defective)"],
      },
      { type: "textarea", k: "remarks", label: "Remarks" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // FIELD SERVICE & GENERAL
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: "TR01",
    name: "Technical Report",
    category: "Field Service & General",
    who: "Technician (approved by Project Manager)",
    desc: "In-house field service report: nature of visit, machine details, fault, findings, correction, result, parts and job time.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "vehicleNo", label: "Vehicle no." },
          { k: "contactPerson", label: "Contact person" },
          { k: "telNo", label: "Tel. no." },
          { k: "machineModel", label: "Machine model" },
          { k: "machineCapacity", label: "Capacity" },
          { k: "machineSerial", label: "Machine serial no." },
        ],
      },
      {
        type: "choices",
        k: "natureOfVisit",
        title: "Nature of visit",
        multi: true,
        options: ["Planned maintenance", "Service", "Repairs", "Normal customer visit"],
      },
      { type: "textarea", k: "faultReported", label: "Fault reported" },
      { type: "textarea", k: "findings", label: "Findings" },
      { type: "textarea", k: "correction", label: "Correction" },
      { type: "textarea", k: "finalResult", label: "Final result" },
      { type: "textarea", k: "partsToOrder", label: "Parts to order" },
      { type: "textarea", k: "customerComments", label: "Customer comments" },
      {
        type: "rows",
        key: "jobTime",
        title: "Job time",
        cols: ["Time in", "Time out", "Mileage (km)"],
        rows: 1,
      },
    ],
  },
  {
    code: "GN01",
    name: "Site Visit Report",
    category: "Field Service & General",
    who: "Engineer / Technician",
    desc: "General record of a site visit: purpose, observations and actions.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "site", label: "Site / client" },
          { k: "contact", label: "Client contact" },
          { k: "purpose", label: "Purpose of visit" },
          { k: "date", label: "Date", inputType: "date" },
        ],
      },
      { type: "textarea", k: "observations", label: "Observations" },
      { type: "textarea", k: "actions", label: "Actions agreed / taken" },
      { type: "textarea", k: "followUp", label: "Follow-up required" },
    ],
  },
  {
    code: "GN02",
    name: "Commissioning / Handover Certificate",
    category: "Field Service & General",
    who: "Engineer",
    desc: "Certify that a system / installation is commissioned and handed over.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "system", label: "System / installation" },
          { k: "client", label: "Client" },
          { k: "location", label: "Location" },
          { k: "handoverDate", label: "Handover date", inputType: "date" },
        ],
      },
      {
        type: "checklist",
        title: "Handover checklist",
        yes: "DONE",
        no: "OUTSTANDING",
        items: [
          "Installation complete per scope",
          "Commissioning tests passed",
          "As-built / O&M documentation supplied",
          "Client operators trained",
          "Spares / consumables handed over",
          "Snags cleared (attach CN07 if any)",
          "Warranty terms explained",
        ],
      },
      { type: "textarea", k: "outstanding", label: "Outstanding items / conditions" },
    ],
  },
  {
    code: "GN03",
    name: "Job Completion Sign-off",
    category: "Field Service & General",
    who: "Technician / Client",
    desc: "Confirm work is complete and accepted by the client.",
    sections: [
      {
        type: "fields",
        fields: [
          { k: "jobRef", label: "Job / work order ref." },
          { k: "client", label: "Client" },
          { k: "completionDate", label: "Completion date", inputType: "date" },
        ],
      },
      { type: "textarea", k: "workDone", label: "Summary of work completed" },
      {
        type: "checklist",
        title: "Acceptance",
        yes: "YES",
        no: "NO",
        items: [
          "Work carried out to satisfaction",
          "Site left clean and safe",
          "Client accepts completion",
        ],
      },
      { type: "textarea", k: "clientComments", label: "Client comments" },
    ],
  },
];

export function templateByCode(code) {
  return TEMPLATES.find((t) => t.code === code) || null;
}

/** OK / problem is the default; engineer forms pass explicit states. */
export function defaultStates(yes = "OK", no = "NO") {
  return [
    { key: "ok", label: yes },
    { key: "problem", label: no },
  ];
}

/** Which token colour a result state pill uses. */
export const STATE_COLOR = {
  ok: "var(--tech-green)",
  pass: "var(--tech-green)",
  attn: "var(--tech-amber)",
  adj: "var(--tech-amber)",
  na: "var(--tech-slate)",
  problem: "var(--tech-red)",
  fail: "var(--tech-red)",
};
