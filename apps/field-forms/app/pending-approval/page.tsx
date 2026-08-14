import SignOutButton from "@/components/SignOutButton";

export default function PendingApprovalPage() {
  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-md mx-auto px-6 py-20 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--pine-100)] text-[var(--pine-700)] mb-4">
          ⏳
        </div>
        <h1 className="font-display text-2xl text-[var(--ink-900)] mb-2">
          Awaiting approval
        </h1>
        <p className="text-[var(--ink-600)] mb-8">
          Your account has been created but needs to be approved by an admin
          before you can access forms. You&apos;ll be able to sign in normally
          once that happens.
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}
