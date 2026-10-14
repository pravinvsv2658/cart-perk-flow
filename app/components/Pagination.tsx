export interface PaginationInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginationProps {
  pagination: PaginationInfo;
  onPageChange: (newPage: number) => void;
  itemLabel?: string;
}

export function Pagination({
  pagination,
  onPageChange,
  itemLabel = "items",
}: PaginationProps) {
  const { page, pageSize, totalItems, totalPages } = pagination;

  if (totalPages <= 1) {
    return null;
  }

  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalItems);

  return (
    <s-box padding="base" border="base">
      <s-stack
        direction="inline"
        justifyContent="space-between"
        alignItems="center"
      >
        <s-text tone="neutral">
          Showing {startItem} to {endItem} of {totalItems} {itemLabel}
        </s-text>

        <s-stack direction="inline" gap="small" alignItems="center">
          <s-button
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </s-button>

          <s-text>
            Page {page} of {totalPages}
          </s-text>

          <s-button
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}
