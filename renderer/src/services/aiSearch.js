export async function aiSearch(query) {
  // simulate AI thinking time
  await new Promise((r) => setTimeout(r, 600));

  return [
    {
      name: "Project_Proposal_v3.docx",
      size: 856 * 1024,
      modified: new Date(),
      isDirectory: false,
      tags: ["work", "proposal", "important"],
      reason: "Matches keywords: proposal, work",
    },
    {
      name: "Team_Meeting_Notes.pdf",
      size: 1200 * 1024,
      modified: new Date(),
      isDirectory: false,
      tags: ["meeting", "notes"],
      reason: "Related to team discussions",
    },
  ];
}
