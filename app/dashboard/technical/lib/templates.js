/**
 * The QSL weighbridge maintenance form catalogue — ported verbatim from the
 * standalone Workflow Reports app (src/lib/templates.js) so every sheet renders
 * with the exact sections, wording and result states it has there.
 *
 * Section types: `fields`, `textarea`, `checklist` (optional yes/no labels or an
 * explicit `states` set), `choices` (radio / multi / dropdown), `weekly` (the
 * End–Middle–End test), `loadcells`, and `rows` (a small grid).
 */

// Result-state sets for engineer checklists.
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

export const TEMPLATES = [
  {
    code: "WB01",
    name: "Daily Site Check",
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
    code: "SI01",
    name: "Site Instruction",
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
    code: "TR01",
    name: "Technical Report",
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
