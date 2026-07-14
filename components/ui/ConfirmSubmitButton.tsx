"use client";

/** A form submit button that asks for a native browser confirmation first —
 *  for actions with real-world side effects (e.g. emailing every user) where
 *  this app's usual plain-submit pattern (see admin/users' Remove/Reject
 *  buttons) is too easy to trigger by accident. */
export function ConfirmSubmitButton({
  confirmMessage,
  children,
  className,
}: {
  confirmMessage: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
