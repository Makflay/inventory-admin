export type AvailableItemsPageRequest = {
  search?: string;
} & (
  | {
      after?: never;
      before?: never;
    }
  | {
      after: string;
      before?: never;
    }
  | {
      after?: never;
      before: string;
    }
);

export type AvailableItemsPageInfo = {
  startCursor: string | null;
  endCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type AvailableItemsPage = {
  ids: number[];
  pageInfo: AvailableItemsPageInfo;
};

export type SelectedItems = {
  ids: number[];
};
