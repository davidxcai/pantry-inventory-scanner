// Pure list logic for the public student catalog (rows from the available_items view, no counts).

export type PublicAvailability = "in_stock" | "low" | "out";

export type CatalogRow = {
  id: string;
  name: string;
  category: string | null;
  thumbnail_path: string | null;
  availability: PublicAvailability;
  updated_at: string | null;
  updated_by_name: string | null;
};

export type CatalogFilter = {
  search: string;
  category: string | null;
  hideOut: boolean;
};

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Search matches every typed word against name or category. Most recently updated first (never-updated last), then by name.
export function filterCatalog(rows: CatalogRow[], f: CatalogFilter): CatalogRow[] {
  const words = norm(f.search).split(/\s+/).filter(Boolean);
  return rows
    .filter((r) => {
      if (f.hideOut && r.availability === "out") return false;
      if (f.category && r.category !== f.category) return false;
      if (!words.length) return true;
      const haystack = norm(`${r.name} ${(r.category ?? "").replaceAll("_", " ")}`);
      return words.every((w) => haystack.includes(w));
    })
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || a.name.localeCompare(b.name));
}
