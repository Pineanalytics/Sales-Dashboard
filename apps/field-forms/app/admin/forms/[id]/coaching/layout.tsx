import { createClient } from "@/lib/supabase/server";
import CoachingAdminNav from "@/components/CoachingAdminNav";

export default async function AdminCoachingLayout({
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
      <div className="max-w-6xl mx-auto w-full px-6 pt-8">
        <CoachingAdminNav formId={id} />
      </div>
      {children}
    </div>
  );
}
