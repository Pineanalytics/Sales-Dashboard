"use client";

/** A form submit button that asks for a native browser confirmation first —
 *  for actions with real-world side effects (e.g. emailing every user) where
 *  this app's usual plain-submit pattern (see admin/users' Remove/Reject
 *  buttons) is too easy to trigger by accident. Accepts an optional
 *  `formAction` so several of these can share one `<form>` with different
 *  server actions per button (e.g. Save / Save & Send / Reset). */
export function ConfirmSubmitButton({
  confirmMessage,
  children,
  className,
  formAction,
}: {
  confirmMessage: string;
  children: React.ReactNode;
  className?: string;
  formAction?: (formData: FormData) => void;
}) {
  return (
    <button
      type="submit"
      formAction={formAction}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
