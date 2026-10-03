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

export type SelectedItemsPageRequest = {
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

export type SelectedItemsPage = {
  ids: number[];
  pageInfo: AvailableItemsPageInfo;
};

export type SelectionBatchOperation = {
  id: number;
  selected: boolean;
};

export type SelectionBatchRequest = {
  operations: SelectionBatchOperation[];
};

export type SelectionBatchSuccess = {
  id: number;
  selected: boolean;
  success: true;
};

export type SelectionBatchFailure = {
  id: number;
  selected: boolean;
  success: false;
  error: string;
  message: string;
};

export type SelectionBatchResult =
  | SelectionBatchSuccess
  | SelectionBatchFailure;

export type SelectionBatchResponse = {
  results: SelectionBatchResult[];
};

export type AddItemsBatchRequest = {
  ids: number[];
};

export type AddItemAddedResult = {
  id: number;
  status: "added";
};

export type AddItemAlreadyExistsResult = {
  id: number;
  status: "already_exists";
};

export type AddItemRejectedResult = {
  id: number;
  status: "rejected";
  error: string;
  message: string;
};

export type AddItemBatchResult =
  | AddItemAddedResult
  | AddItemAlreadyExistsResult
  | AddItemRejectedResult;

export type AddItemsBatchResponse = {
  results: AddItemBatchResult[];
};

export type ReadBatchOperation =
  | {
      requestId: string;
      type: "available";
      request: AvailableItemsPageRequest;
    }
  | {
      requestId: string;
      type: "selected";
      request: SelectedItemsPageRequest;
    };

export type ReadBatchRequest = {
  operations: ReadBatchOperation[];
};

export type AvailableReadSuccess = {
  requestId: string;
  type: "available";
  success: true;
  page: AvailableItemsPage;
};

export type SelectedReadSuccess = {
  requestId: string;
  type: "selected";
  success: true;
  page: SelectedItemsPage;
};

export type ReadFailure = {
  requestId: string;
  success: false;
  error: string;
  message: string;
};

export type ReadBatchResult =
  | AvailableReadSuccess
  | SelectedReadSuccess
  | ReadFailure;

export type ReadBatchResponse = {
  results: ReadBatchResult[];
};
