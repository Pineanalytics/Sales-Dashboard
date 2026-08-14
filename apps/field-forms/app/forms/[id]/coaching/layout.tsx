import { createClient } from "@/lib/supabase/server";

export default async function CoachingLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: form } = await supabase.from("forms").select("theme_vars").eq("id", id).single();

  return (
    <div style={(form?.theme_vars as React.CSSProperties) ?? undefined} className="flex-1 flex flex-col">
      {children}
    </div>
  );
}
