/**
 * The project lifecycle — five phases, run in order, each gated on the one
 * before it. This is the "step by step" rule the module now enforces: you
 * cannot move to the next phase until the current one is done.
 *
 * PURE and in its own module so both the server stepper (ProjectLifecycle) and
 * the client sub-nav (ProjectsNav) decide gating the same way — a rule stated
 * once. `done`/`unlocked` are computed from flags the workspace query already
 * carries (see listProjectsForWorkspace / getProjectSetupState), so no extra
 * round trip is needed to lock a tab.
 */

/**
 * Each phase, in order, with the section keys (from ./sections) that belong to
 * it. "overview" and "budget" are the two fixed tabs; the rest are SECTIONS
 * keys. The last phase, "close", owns no tab — it is the finished state the
 * stepper shows, reached by closing the project out on its overview.
 */
export const PHASES = [
  {
    key: "setup",
    num: 1,
    label: "Set up",
    blurb: "Type, client, contract terms and a priced bill of quantities.",
    sections: ["overview", "contract", "boq", "methodology", "documents"],
  },
  {
    key: "budget",
    num: 2,
    label: "Budget",
    blurb: "Build the budget from the bill and get it approved.",
    sections: ["budget"],
  },
  {
    key: "deliver",
    num: 3,
    label: "Deliver",
    blurb: "Programme, milestones, the site diary and labour.",
    sections: ["programme", "milestones", "diary", "timesheets", "instructions"],
  },
  {
    key: "certify",
    num: 4,
    label: "Money in",
    blurb: "Certificates, variations, cash requests and cost lines.",
    sections: ["certificates", "variations", "cashRequisitions", "costs"],
  },
  {
    key: "close",
    num: 5,
    label: "Close",
    blurb: "The final account and close-out.",
    sections: [],
  },
];

/** section key → phase key. */
export const PHASE_OF_SECTION = Object.freeze(
  PHASES.reduce((acc, p) => {
    for (const s of p.sections) acc[s] = p.key;
    return acc;
  }, {}),
);

/** Where a phase's step link leads. */
export function phaseHref(phaseKey, projectId) {
  switch (phaseKey) {
    case "setup":
      return `/dashboard/projects/boq?project=${projectId}`;
    case "budget":
      return `/dashboard/projects/${projectId}/budget`;
    case "deliver":
      return `/dashboard/projects/programme?project=${projectId}`;
    case "certify":
      return `/dashboard/projects/ipc?project=${projectId}`;
    case "close":
    default:
      return `/dashboard/projects/${projectId}`;
  }
}

const bool = (v) => v === true || v === "t" || v === "true";

/**
 * Compute each phase's done/unlocked/current state from a project's flags.
 *
 * `input` carries what both callers already have: hasType, hasClient, hasBoq,
 * hasApprovedBudget, hasTasks, status, progressPercent, and whether the bill
 * applies at all (showsBoq — a supply-only job needs no priced bill to be set
 * up). A phase is UNLOCKED only when every phase before it is DONE.
 */
export function computeLifecycle(input = {}) {
  const closed = input.status === "closed" || input.status === "completed";
  const boqApplies = input.showsBoq !== false;

  const done = {
    setup:
      bool(input.hasType) &&
      bool(input.hasClient) &&
      (bool(input.hasBoq) || !boqApplies),
    budget: bool(input.hasApprovedBudget),
    deliver: bool(input.hasTasks),
    certify: closed || Number(input.progressPercent) >= 100,
    close: closed,
  };

  let prevAllDone = true;
  let currentKey = null;
  const steps = PHASES.map((p) => {
    const unlocked = prevAllDone;
    const isDone = !!done[p.key];
    if (unlocked && !isDone && !currentKey) currentKey = p.key;
    prevAllDone = prevAllDone && isDone;
    return {
      key: p.key,
      num: p.num,
      label: p.label,
      blurb: p.blurb,
      done: isDone,
      unlocked,
    };
  });

  // Mark the current step.
  const withCurrent = steps.map((s) => ({ ...s, current: s.key === currentKey }));
  const unlockedByKey = Object.fromEntries(withCurrent.map((s) => [s.key, s.unlocked]));

  return {
    steps: withCurrent,
    currentKey,
    /** Is a section's phase still locked? "overview" is never locked. */
    isSectionLocked(sectionKey) {
      if (sectionKey === "overview") return false;
      const phaseKey = PHASE_OF_SECTION[sectionKey];
      if (!phaseKey) return false; // unknown section — never gate it off
      return !unlockedByKey[phaseKey];
    },
    phaseOfSection: (sectionKey) => PHASE_OF_SECTION[sectionKey] ?? null,
    labelOfPhase: (phaseKey) =>
      PHASES.find((p) => p.key === phaseKey)?.label ?? "",
  };
}
