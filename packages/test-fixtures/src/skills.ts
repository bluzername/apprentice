import type { CompletionPredicate, SkillDraft } from "@apprentice/schemas";
import type { ScenarioName, TemplateName } from "./types.js";

export interface DemoSkillSubtask {
  readonly title: string;
  readonly goal: string;
  readonly completionCriteria: string;
  readonly keySteps: readonly string[];
  readonly appOrDomain: string;
  readonly completionPredicates: readonly CompletionPredicate[];
}

/** A SkillDraft whose subtasks also carry completion predicates for the run engine. */
export interface DemoSkillTemplate extends Omit<SkillDraft, "subtasks"> {
  readonly subtasks: readonly DemoSkillSubtask[];
}

export type MockRunAction = "click" | "type_text" | "press_key" | "subtask_complete" | "done";

export interface MockRunStep {
  readonly subtaskIndex: number;
  readonly templateName: TemplateName;
  readonly action: MockRunAction;
  readonly text?: string;
  readonly key?: string;
}

const CHROME_ID = "com.google.Chrome";

export const demoSkillTemplates: Readonly<Record<ScenarioName, DemoSkillTemplate>> = {
  postMeetingFollowup: {
    name: "Post-meeting follow-up",
    description:
      "After a customer meeting, log the summary in the CRM, send a follow-up email, and create a task for the next step.",
    goal: "Turn meeting notes into a CRM activity, a follow-up email, and a tracked task.",
    trigger: "A meeting notes page is open shortly after a calendar meeting ends.",
    subtasks: [
      {
        title: "Copy the meeting summary",
        goal: "Open the meeting notes and copy the summary section.",
        completionCriteria: "The summary text is on the clipboard.",
        keySteps: ["Open the meeting notes page", "Select the Summary section", "Copy it"],
        appOrDomain: "notes.example",
        completionPredicates: [{ kind: "url_pattern", pattern: "/meeting/:id" }, { kind: "user_confirm" }]
      },
      {
        title: "Log the activity in the CRM",
        goal: "Open the contact record and log a meeting activity with the summary as notes.",
        completionCriteria: "A new activity appears in the contact's recent activity list.",
        keySteps: ["Open the contact page", "Click Log activity", "Choose Meeting", "Paste the summary", "Click Save"],
        appOrDomain: "crm.example",
        completionPredicates: [{ kind: "url_pattern", pattern: "/contact/:id" }, { kind: "title_contains", text: "Contacts" }]
      },
      {
        title: "Draft the follow-up email",
        goal: "Compose a follow-up email to the contact summarizing next steps.",
        completionCriteria: "The compose form is filled in and ready to send.",
        keySteps: ["Open compose", "Fill To and Subject", "Write the body", "Stop before sending"],
        appOrDomain: "mail.example",
        completionPredicates: [{ kind: "url_pattern", pattern: "/compose" }, { kind: "user_confirm" }]
      },
      {
        title: "Create the follow-up task",
        goal: "Add a task on the board for the agreed next step.",
        completionCriteria: "The new task appears in the To do column.",
        keySteps: ["Open the board", "Click New task", "Enter the title and due date", "Submit"],
        appOrDomain: "tasks.example",
        completionPredicates: [{ kind: "url_pattern", pattern: "/board/:id" }, { kind: "ocr_contains", text: "To do" }]
      }
    ],
    variables: [
      { name: "contact", kind: "person", description: "The contact met with", examples: ["Jordan Rivera"], required: true },
      { name: "meetingSummary", kind: "text", description: "Summary copied from the notes", examples: [], required: true },
      { name: "nextStep", kind: "text", description: "Agreed follow-up action", examples: ["Send revised proposal"], required: true }
    ],
    successCriteria: ["CRM shows the logged meeting", "Follow-up email drafted", "Task created on the board"],
    riskNotes: ["Sending email is external communication and always needs approval."],
    allowedApps: [CHROME_ID],
    allowedDomains: ["notes.example", "crm.example", "mail.example", "tasks.example"],
    origin: "deterministic",
    confidence: 0.8
  },
  invoiceProcessing: {
    name: "Invoice processing",
    description: "Download a supplier invoice, rename and file it, record it in accounting, and confirm in chat.",
    goal: "File an incoming invoice PDF and register it as a bill.",
    trigger: "An email with an invoice PDF attachment is opened.",
    subtasks: [
      {
        title: "Download the invoice PDF",
        goal: "Save the attached PDF from the email.",
        completionCriteria: "The PDF is in the Downloads folder.",
        keySteps: ["Open the invoice email", "Click Download on the attachment"],
        appOrDomain: "mail.example",
        completionPredicates: [{ kind: "url_pattern", pattern: "/inbox/:id" }, { kind: "user_confirm" }]
      },
      {
        title: "Rename the PDF",
        goal: "Open the PDF in Preview and save it with the date, supplier, and invoice number.",
        completionCriteria: "A renamed copy exists in Downloads.",
        keySteps: ["Open the file from Finder", "Press cmd+shift+s", "Type the new name", "Click Save"],
        appOrDomain: "com.apple.Preview",
        completionPredicates: [{ kind: "app_frontmost", bundleId: "com.apple.Preview" }, { kind: "user_confirm" }]
      },
      {
        title: "Move it to the Invoices folder",
        goal: "File the renamed PDF in the Invoices folder.",
        completionCriteria: "The file is listed under Invoices.",
        keySteps: ["Select the file in Finder", "Choose Move to", "Pick Invoices"],
        appOrDomain: "com.apple.finder",
        completionPredicates: [{ kind: "app_frontmost", bundleId: "com.apple.finder" }, { kind: "title_contains", text: "Invoices" }]
      },
      {
        title: "Register the bill",
        goal: "Upload the PDF as a new bill and fill in amount and due date.",
        completionCriteria: "The bill is saved and appears in the bills list.",
        keySteps: ["Open New bill", "Click Upload", "Enter amount and due date", "Click Save bill"],
        appOrDomain: "accounting.example",
        completionPredicates: [{ kind: "url_pattern", pattern: "/bills/new" }, { kind: "ocr_contains", text: "Save bill" }]
      },
      {
        title: "Confirm in the finance channel",
        goal: "Post a short message saying the invoice was filed.",
        completionCriteria: "The message is drafted in the finance channel composer.",
        keySteps: ["Open the finance channel", "Type the confirmation", "Stop before sending"],
        appOrDomain: "chat.example",
        completionPredicates: [{ kind: "url_pattern", pattern: "/channel/:id" }, { kind: "user_confirm" }]
      }
    ],
    variables: [
      { name: "supplier", kind: "text", description: "Supplier name", examples: ["Acme Ltd"], required: true },
      { name: "invoiceNumber", kind: "identifier", description: "Invoice number", examples: ["INV-2041"], required: true },
      { name: "amount", kind: "amount", description: "Amount due", examples: ["4,250.00"], required: true },
      { name: "dueDate", kind: "date", description: "Due date", examples: ["2026-09-30"], required: true }
    ],
    successCriteria: ["Renamed PDF in Invoices", "Bill saved in accounting", "Confirmation drafted"],
    riskNotes: ["Amounts are entered into a financial system; every typed value needs approval."],
    allowedApps: [CHROME_ID, "com.apple.finder", "com.apple.Preview"],
    allowedDomains: ["mail.example", "accounting.example", "chat.example"],
    origin: "deterministic",
    confidence: 0.75
  },
  candidateReview: {
    name: "Candidate review",
    description: "Review a candidate's resume, write interview notes, update the ATS status, and schedule the interview.",
    goal: "Move a candidate from phone screen to a scheduled interview.",
    trigger: "A candidate page is opened from the ATS pipeline.",
    subtasks: [
      {
        title: "Review the resume",
        goal: "Open the Resume tab and read through it.",
        completionCriteria: "The resume has been scrolled to the end.",
        keySteps: ["Open the candidate page", "Click the Resume tab", "Scroll through"],
        appOrDomain: "ats.example",
        completionPredicates: [{ kind: "url_pattern", pattern: "/candidates/:id" }, { kind: "user_confirm" }]
      },
      {
        title: "Write interview notes",
        goal: "Capture strengths and concerns in a notes document.",
        completionCriteria: "The notes document has a title and body.",
        keySteps: ["Open a notes document", "Enter the title", "Write the notes"],
        appOrDomain: "notes.example",
        completionPredicates: [{ kind: "url_pattern", pattern: "/doc/:id" }, { kind: "user_confirm" }]
      },
      {
        title: "Update the candidate status",
        goal: "Change the ATS status to Interview.",
        completionCriteria: "The status badge on the candidate page reads Interview.",
        keySteps: ["Click Change status", "Select Interview", "Click Update"],
        appOrDomain: "ats.example",
        completionPredicates: [{ kind: "url_pattern", pattern: "/candidates/:id" }, { kind: "ocr_contains", text: "Interview" }]
      },
      {
        title: "Schedule the interview",
        goal: "Create the interview event with the candidate and interviewers.",
        completionCriteria: "The event form is complete and submitted.",
        keySteps: ["Open the schedule view", "Click Schedule", "Fill title, date, and guests", "Submit"],
        appOrDomain: "calendar.example",
        completionPredicates: [{ kind: "url_pattern", pattern: "/schedule" }, { kind: "dom_marker", marker: "event-created" }]
      }
    ],
    variables: [
      { name: "candidate", kind: "person", description: "Candidate being reviewed", examples: ["Jordan Rivera"], required: true },
      { name: "role", kind: "text", description: "Role applied for", examples: ["Senior Operations Analyst"], required: false },
      { name: "interviewDate", kind: "date", description: "Proposed interview slot", examples: ["2026-09-09 11:00"], required: true }
    ],
    successCriteria: ["Notes written", "Status set to Interview", "Interview scheduled"],
    riskNotes: ["Calendar invites notify external guests; confirm before submitting."],
    allowedApps: [CHROME_ID],
    allowedDomains: ["ats.example", "notes.example", "calendar.example"],
    origin: "deterministic",
    confidence: 0.7
  }
};

/** Plausible guided run over the templates: 1-3 actions per subtask, then subtask_complete; last step is done. */
export const mockRunScripts: Readonly<Record<ScenarioName, readonly MockRunStep[]>> = {
  postMeetingFollowup: [
    { subtaskIndex: 0, templateName: "notesPage", action: "press_key", key: "c" },
    { subtaskIndex: 0, templateName: "notesPage", action: "subtask_complete" },
    { subtaskIndex: 1, templateName: "crmContact", action: "click" },
    { subtaskIndex: 1, templateName: "crmLogActivity", action: "type_text", text: "Discussed the revised proposal and agreed on a contract review next week." },
    { subtaskIndex: 1, templateName: "crmLogActivity", action: "click" },
    { subtaskIndex: 1, templateName: "crmContact", action: "subtask_complete" },
    { subtaskIndex: 2, templateName: "mailCompose", action: "type_text", text: "Hi Jordan, thanks for the time today. Next steps are attached below." },
    { subtaskIndex: 2, templateName: "mailCompose", action: "subtask_complete" },
    { subtaskIndex: 3, templateName: "taskBoard", action: "click" },
    { subtaskIndex: 3, templateName: "taskBoard", action: "type_text", text: "Contract review with Acme Ltd" },
    { subtaskIndex: 3, templateName: "taskBoard", action: "press_key", key: "enter" },
    { subtaskIndex: 3, templateName: "taskBoard", action: "subtask_complete" },
    { subtaskIndex: 3, templateName: "taskBoard", action: "done" }
  ],
  invoiceProcessing: [
    { subtaskIndex: 0, templateName: "invoiceEmail", action: "click" },
    { subtaskIndex: 0, templateName: "invoiceEmail", action: "subtask_complete" },
    { subtaskIndex: 1, templateName: "previewPdf", action: "press_key", key: "s" },
    { subtaskIndex: 1, templateName: "previewPdf", action: "type_text", text: "2026-09-01_acme_INV-2041.pdf" },
    { subtaskIndex: 1, templateName: "previewPdf", action: "click" },
    { subtaskIndex: 1, templateName: "previewPdf", action: "subtask_complete" },
    { subtaskIndex: 2, templateName: "finderWindow", action: "click" },
    { subtaskIndex: 2, templateName: "finderWindow", action: "subtask_complete" },
    { subtaskIndex: 3, templateName: "accountingUpload", action: "click" },
    { subtaskIndex: 3, templateName: "accountingUpload", action: "type_text", text: "4250.00" },
    { subtaskIndex: 3, templateName: "accountingUpload", action: "press_key", key: "tab" },
    { subtaskIndex: 3, templateName: "accountingUpload", action: "subtask_complete" },
    { subtaskIndex: 4, templateName: "chatMessage", action: "type_text", text: "Filed INV-2041 from Acme Ltd, due 30 Sep, uploaded to accounting." },
    { subtaskIndex: 4, templateName: "chatMessage", action: "subtask_complete" },
    { subtaskIndex: 4, templateName: "chatMessage", action: "done" }
  ],
  candidateReview: [
    { subtaskIndex: 0, templateName: "atsCandidate", action: "click" },
    { subtaskIndex: 0, templateName: "atsCandidate", action: "press_key", key: "pagedown" },
    { subtaskIndex: 0, templateName: "atsCandidate", action: "subtask_complete" },
    { subtaskIndex: 1, templateName: "notesPage", action: "type_text", text: "Interview notes - Jordan Rivera" },
    { subtaskIndex: 1, templateName: "notesPage", action: "type_text", text: "Strong operations background. Clear communicator. Ask about tooling migration experience." },
    { subtaskIndex: 1, templateName: "notesPage", action: "subtask_complete" },
    { subtaskIndex: 2, templateName: "atsCandidate", action: "click" },
    { subtaskIndex: 2, templateName: "atsStatusDialog", action: "click" },
    { subtaskIndex: 2, templateName: "atsCandidate", action: "subtask_complete" },
    { subtaskIndex: 3, templateName: "calendarSchedule", action: "click" },
    { subtaskIndex: 3, templateName: "calendarSchedule", action: "type_text", text: "Interview - Jordan Rivera" },
    { subtaskIndex: 3, templateName: "calendarSchedule", action: "press_key", key: "enter" },
    { subtaskIndex: 3, templateName: "calendarSchedule", action: "subtask_complete" },
    { subtaskIndex: 3, templateName: "calendarSchedule", action: "done" }
  ]
};
