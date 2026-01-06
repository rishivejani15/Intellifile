export async function analyzeDocument(file) {
  // simulate AI processing
  await new Promise((r) => setTimeout(r, 1000));

  return {
    summary:
      "This document outlines the project scope, objectives, and expected deliverables.",
    keyPoints: [
      "Project timeline is 6 months",
      "Budget approval required",
      "Stakeholders listed in section 2",
    ],
    actions: [
      "Send proposal to client",
      "Schedule kickoff meeting",
      "Review budget section",
    ],
  };
}
