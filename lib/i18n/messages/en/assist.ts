/** English text for AI-2 (pipeline drafts) and AI-3 (run diagnosis); id/assist.ts mirrors it. */
export const assist = {
  pipeline: {
    label: 'Describe the pipeline',
    placeholder: 'e.g. Sync active employees from the SAP export to the employees dataset every weekday at 02:00',
    hint: 'The assistant plans it from your real sources and tables. You review the draft in the editor before anything is saved.',
    action: 'Draft pipeline',
    working: 'Drafting…',
    drafted: 'Draft from {model}. Review every step before saving.',
  },
  diagnose: {
    action: 'Diagnose with AI',
    working: 'Diagnosing…',
    title: 'Diagnosis',
    cause: 'Likely cause',
    steps: 'What to do',
    fix: 'Suggested fix',
    applyFix: 'Apply fix as draft',
    applyTitle: 'Save this fix as a new draft?',
    applyBody: 'The current published version keeps running. Review the draft in the editor and publish it when it looks right.',
    applied: 'Draft v{version} saved with the fix. Open the editor to review and publish it.',
    noFix: 'No automatic fix: this needs a change in the source system or a person’s decision.',
    by: 'From {model}. Personal values were hidden from the model.',
    addTransform: 'Add {transform} to the Map step for {field}{args}',
    changeSeverity: 'Change the {rule} check on {field} to {severity}',
    removeRule: 'Remove the {rule} check on {field}',
  },
  failed: 'The assistant could not help',
} as const
