/**
 * Standard HR letters — the wording HR starts from. Pure: given the employee,
 * the company and a few details, it returns a subject and a body. HR edits the
 * text before issuing; what is stored and printed is what HR issued, so the
 * record is the letter the employee received.
 *
 * Kenyan practice: the appointment letter carries the particulars s.10 of the
 * Employment Act requires in writing (job, start date, pay, hours, leave,
 * notice); probation follows s.42; a warning or show-cause follows s.41.
 */

export const LETTER_KIND_LABELS = {
  offer: "Offer of employment",
  appointment: "Letter of appointment",
  probation_confirmation: "Confirmation of appointment",
  probation_extension: "Extension of probation",
  promotion: "Promotion",
  salary_review: "Salary review",
  transfer: "Transfer",
  warning: "Warning letter",
  show_cause: "Notice to show cause",
  commendation: "Letter of commendation",
  reference: "Reference letter",
  general: "General letter",
};

const kes = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function longDate(d) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(`${String(d).slice(0, 10)}T00:00:00`) : new Date(d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * @param {string} kind one of LETTER_KIND_LABELS
 * @param {object} ctx { employee, company, details }
 *   employee: { fullName, firstName, designation, department, hireDate,
 *               probationEndDate, basicSalary, grossSalary, employeeNumber }
 *   company:  { name }
 *   details:  { effectiveDate, newDesignation, newSalary, newDepartment,
 *               reason, extensionMonths, responseDays, reportingTo }
 * @returns {{ subject: string, body: string }}
 */
export function draftLetter(kind, { employee = {}, company = {}, details = {} } = {}) {
  const name = employee.firstName || employee.fullName || "Sir/Madam";
  const co = company.name || "the Company";
  const role = employee.designation || "your position";
  const dept = employee.department ? ` in the ${employee.department} department` : "";
  const eff = longDate(details.effectiveDate) || "with immediate effect";
  const gross = employee.grossSalary ?? employee.basicSalary;

  switch (kind) {
    case "offer":
      return {
        subject: `Offer of employment — ${details.newDesignation || role}`,
        body: [
          `Dear ${name},`,
          `Following your recent interview, we are pleased to offer you the position of ${details.newDesignation || role}${dept} at ${co}, starting on ${eff}.`,
          `Your gross monthly salary will be ${kes(details.newSalary ?? gross)}, subject to statutory deductions (PAYE, NSSF, SHIF and the Housing Levy).`,
          `The appointment is subject to a probation period of six months, satisfactory references and the documents we have requested.`,
          `Please confirm your acceptance by signing and returning a copy of this letter within seven days.`,
          `We look forward to welcoming you.`,
        ].join("\n\n"),
      };
    case "appointment":
      return {
        subject: `Letter of appointment — ${role}`,
        body: [
          `Dear ${name},`,
          `We are pleased to confirm your appointment as ${role}${dept} at ${co}, with effect from ${longDate(employee.hireDate) || eff}.`,
          `1. Remuneration: a gross monthly salary of ${kes(gross)}, paid monthly in arrears, subject to statutory deductions.`,
          `2. Probation: six months${employee.probationEndDate ? `, ending on ${longDate(employee.probationEndDate)}` : ""}, during which either party may end the employment on seven days' notice.`,
          `3. Hours of work: as set by the Company's policy, not exceeding the hours allowed by law.`,
          `4. Annual leave: twenty-one working days for each completed year of service, in addition to public holidays.`,
          `5. Notice: after confirmation, one month's notice in writing by either party, or one month's pay in lieu.`,
          `6. You will report to ${details.reportingTo || "your head of department"} and abide by the Company's policies, as amended from time to time.`,
          `Please sign and return the duplicate of this letter to confirm your acceptance of these terms.`,
        ].join("\n\n"),
      };
    case "probation_confirmation":
      return {
        subject: "Confirmation of appointment",
        body: [
          `Dear ${name},`,
          `We are pleased to inform you that you have successfully completed your probation period, and your appointment as ${role} is confirmed with effect from ${eff}.`,
          `All other terms and conditions of your employment remain as set out in your letter of appointment.`,
          `We thank you for your contribution so far and wish you continued success.`,
        ].join("\n\n"),
      };
    case "probation_extension":
      return {
        subject: "Extension of probation period",
        body: [
          `Dear ${name},`,
          `Further to your probation review, your probation period is extended by ${details.extensionMonths || 3} month(s), to ${eff}, with your agreement as section 42 of the Employment Act requires.`,
          details.reason ? `The extension is to allow improvement in the following areas: ${details.reason}` : `The areas for improvement were discussed with you at the review.`,
          `Your supervisor will support you during this period, and your performance will be reviewed again before it ends.`,
        ].join("\n\n"),
      };
    case "promotion":
      return {
        subject: `Promotion to ${details.newDesignation || "a new position"}`,
        body: [
          `Dear ${name},`,
          `In recognition of your performance, we are pleased to promote you to the position of ${details.newDesignation || "[new position]"}${details.newDepartment ? ` in the ${details.newDepartment} department` : ""}, with effect from ${eff}.`,
          details.newSalary ? `Your gross monthly salary will be revised to ${kes(details.newSalary)}.` : `Your remuneration will be reviewed in line with the new position.`,
          `Congratulations on your promotion.`,
        ].join("\n\n"),
      };
    case "salary_review":
      return {
        subject: "Salary review",
        body: [
          `Dear ${name},`,
          `Following the salary review, your gross monthly salary is revised from ${kes(gross)} to ${kes(details.newSalary)}, with effect from ${eff}.`,
          `All other terms of your employment remain unchanged.`,
        ].join("\n\n"),
      };
    case "transfer":
      return {
        subject: "Transfer",
        body: [
          `Dear ${name},`,
          `You are transferred to ${details.newDepartment || "[department / station]"}${details.newDesignation ? ` as ${details.newDesignation}` : ""}, with effect from ${eff}.`,
          `All other terms of your employment remain unchanged. Please hand over your current duties before the transfer date.`,
        ].join("\n\n"),
      };
    case "show_cause":
      return {
        subject: "Notice to show cause",
        body: [
          `Dear ${name},`,
          `It has been reported that ${details.reason || "[describe the incident, with the date]"}.`,
          `This conduct, if proved, amounts to a breach of your terms of employment and the Company's policies.`,
          `You are required to explain in writing, within ${details.responseDays || 3} days of receiving this letter, why disciplinary action should not be taken against you.`,
          `You may be invited to a disciplinary hearing, where you are entitled to be accompanied by a fellow employee or a shop-floor union representative of your choice.`,
        ].join("\n\n"),
      };
    case "warning":
      return {
        subject: "Warning letter",
        body: [
          `Dear ${name},`,
          `Following the disciplinary hearing on the matter of ${details.reason || "[the matter]"}, at which you were heard, the Company has decided to issue you with this warning.`,
          `You are expected to improve your conduct immediately. A repeat of this or similar conduct may lead to further disciplinary action, up to and including dismissal.`,
          `This warning will remain on your file for the period stated in the Company's disciplinary policy. You may appeal against it in writing within seven days.`,
        ].join("\n\n"),
      };
    case "commendation":
      return {
        subject: "Letter of commendation",
        body: [
          `Dear ${name},`,
          `On behalf of ${co}, we wish to commend you for ${details.reason || "your outstanding work"}.`,
          `Your commitment reflects the Company's values, and it is appreciated.`,
        ].join("\n\n"),
      };
    case "reference":
      return {
        subject: "To whom it may concern",
        body: [
          `This is to confirm that ${employee.fullName || "[name]"} has been employed by ${co} as ${role}${dept} since ${longDate(employee.hireDate) || "[date]"}.`,
          details.reason || "During this time they have carried out their duties diligently and professionally.",
          `This letter is issued at the employee's request.`,
        ].join("\n\n"),
      };
    default:
      return { subject: details.subject || "", body: `Dear ${name},\n\n` };
  }
}
