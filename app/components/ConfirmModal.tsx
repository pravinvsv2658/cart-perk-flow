import type { ReactNode } from "react";

export interface ConfirmModalProps {
  id: string;
  heading: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "secondary" | "tertiary";
  confirmTone?: "critical";
  onConfirm?: () => void;
  onCancel?: () => void;
  children?: ReactNode;
}

export function ConfirmModal({
  id,
  heading,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  confirmTone,
  onConfirm,
  onCancel,
  children,
}: ConfirmModalProps) {
  return (
    <s-modal id={id} heading={heading}>
      <s-box padding="base">
        <s-stack gap="base">
          {description && <s-paragraph>{description}</s-paragraph>}
          {children}

          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
          >
            <s-button commandFor={id} command="--hide" onClick={onCancel}>
              {cancelLabel}
            </s-button>

            <s-button
              variant={confirmVariant}
              tone={confirmTone}
              commandFor={id}
              command="--hide"
              onClick={onConfirm}
            >
              {confirmLabel}
            </s-button>
          </s-stack>
        </s-stack>
      </s-box>
    </s-modal>
  );
}
