// Master reference data from LATITUDE ONLINE FORM.xlsx — used to auto-populate
// codes for CSV export instead of asking the merchandiser to enter them.

export const RETAILER_INFO: Record<
  string,
  { rank: number; code: string; branchNumber: number }
> = {
  "Carrefour(Majid Al Futtaim)": { rank: 1, code: "CF", branchNumber: 1 },
  Naivas: { rank: 2, code: "NV", branchNumber: 2 },
  Quickmart: { rank: 3, code: "QM", branchNumber: 3 },
  Chandarana: { rank: 4, code: "CH", branchNumber: 4 },
  "China Square(Home Superstore)": { rank: 5, code: "CQ", branchNumber: 5 },
  "Clean Shelf": { rank: 6, code: "CS", branchNumber: 6 },
};

// Retailer names exempt from the mandatory shelf-photo requirement.
export const PHOTO_EXEMPT_RETAILERS: string[] = ["Carrefour(Majid Al Futtaim)"];

export const REGION_CODES: Record<string, string> = {
  CBD: "CB",
  "Upper Hill": "CB",
  Westlands: "WE",
  "Limuru Road": "WE",
  Eastlands: "EA",
  Kiambu: "KI",
  "Thika Road": "KI",
  "Mombasa Road": "MR",
  Kitengela: "MR",
  "Athi River": "MR",
  Machakos: "MR",
  Karen: "SO",
  // Chaka / Riruta added to the master list without a region code yet.
  Chaka: "",
  Riruta: "",
};
