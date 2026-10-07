export type SetSelectionOperation = {
  kind: "set_selection";
  id: number;
  selected: boolean;
};

export type ReorderSelectedOperation = {
  kind: "reorder_selected";
  draggedId: number;
  targetId: number;
  placement: "before" | "after";
  search: string;
};

export type SelectionMutationOperation =
  | SetSelectionOperation
  | ReorderSelectedOperation;

export type SelectionBatchRequest = {
  operations: SelectionMutationOperation[];
  baseServerVersion?: number;
};

export type SetSelectionSuccess = SetSelectionOperation & {
  success: true;
};

export type SetSelectionFailure = SetSelectionOperation & {
  success: false;
  error: string;
  message: string;
};

export type ReorderSelectedSuccess = ReorderSelectedOperation & {
  success: true;
  changed: boolean;
};

export type ReorderSelectedFailure = ReorderSelectedOperation & {
  success: false;
  error:
    | "DRAGGED_NOT_SELECTED"
    | "TARGET_NOT_SELECTED"
    | "DRAGGED_NOT_MATCHING_SEARCH"
    | "TARGET_NOT_MATCHING_SEARCH"
    | "SAME_REORDER_ITEM";
  message: string;
};

export type StaleServerVersionResponse = {
  error: "STALE_SERVER_VERSION";
  message: string;
  serverVersion: number;
};

export type SelectionBatchResult =
  | SetSelectionSuccess
  | SetSelectionFailure
  | ReorderSelectedSuccess
  | ReorderSelectedFailure;

export type SelectionBatchResponse = {
  results: SelectionBatchResult[];
  serverVersion: number;
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
  serverVersion: number;
};
