import type { ReactNode } from "react";

export interface ActionProps {
  content: string;
  href?: string;
  onClick?: () => void;
  accessibilityLabel?: string;
  variant?: "primary" | "secondary" | "tertiary";
  tone?: "critical";
}

export interface EmptyStateProps {
  heading: string;
  description?: string;
  imageSrc?: string;
  imageAlt?: string;
  aspectRatio?: `${number}/${number}` | `${number}`;
  primaryAction?: ActionProps;
  secondaryAction?: ActionProps;
  accessibilityLabel?: string;
  children?: ReactNode;
}

export function EmptyState({
  heading,
  description,
  imageSrc,
  imageAlt = "Empty state graphic",
  aspectRatio = "2/1",
  primaryAction,
  secondaryAction,
  accessibilityLabel = "Empty state",
  children,
}: EmptyStateProps) {
  return (
    <s-section accessibilityLabel={accessibilityLabel}>
      <s-grid gap="base" justifyItems="center" paddingBlock="large-400">
        {imageSrc && (
          <s-box maxInlineSize="480px">
            <s-image aspectRatio={aspectRatio} src={imageSrc} alt={imageAlt} />
          </s-box>
        )}

        <s-grid justifyItems="center" maxInlineSize="450px" gap="base">
          <s-stack alignItems="center">
            <s-heading>{heading}</s-heading>
            {description && <s-paragraph>{description}</s-paragraph>}
          </s-stack>

          {(primaryAction || secondaryAction) && (
            <s-button-group>
              {secondaryAction && (
                <s-button
                  slot="secondary-actions"
                  aria-label={
                    secondaryAction.accessibilityLabel || secondaryAction.content
                  }
                  href={secondaryAction.href}
                  onClick={secondaryAction.onClick}
                  variant={secondaryAction.variant}
                  tone={secondaryAction.tone}
                >
                  {secondaryAction.content}
                </s-button>
              )}

              {primaryAction && (
                <s-button
                  slot="primary-action"
                  aria-label={
                    primaryAction.accessibilityLabel || primaryAction.content
                  }
                  href={primaryAction.href}
                  onClick={primaryAction.onClick}
                  variant={primaryAction.variant || "primary"}
                  tone={primaryAction.tone}
                >
                  {primaryAction.content}
                </s-button>
              )}
            </s-button-group>
          )}

          {children}
        </s-grid>
      </s-grid>
    </s-section>
  );
}
