export async function findDuplicates() {
  // simulate scanning time
  await new Promise((r) => setTimeout(r, 1200));

  return [
    {
      reason: "Same file name and size",
      files: [
        {
          name: "Project_Proposal_v3.docx",
          size: 856 * 1024,
          modified: new Date(),
          isDirectory: false,
        },
        {
          name: "Project_Proposal_v3 (copy).docx",
          size: 856 * 1024,
          modified: new Date(),
          isDirectory: false,
        },
      ],
    },
    {
      reason: "Identical content",
      files: [
        {
          name: "Budget_2024.xlsx",
          size: 234 * 1024,
          modified: new Date(),
          isDirectory: false,
        },
        {
          name: "Budget_2024_backup.xlsx",
          size: 234 * 1024,
          modified: new Date(),
          isDirectory: false,
        },
      ],
    },
  ];
}
