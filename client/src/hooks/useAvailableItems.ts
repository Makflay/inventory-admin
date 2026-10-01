import { useEffect, useState } from "react";

import { getAvailableItems } from "../api/items.api";
import type { AvailableItemsPage } from "../api/items.api";

type AvailableItemsState =
  | { status: "loading" }
  | { status: "success"; page: AvailableItemsPage }
  | { status: "error"; message: string };

export function useAvailableItems(): AvailableItemsState {
  const [state, setState] = useState<AvailableItemsState>({
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadItems() {
      try {
        const page = await getAvailableItems(controller.signal);

        if (controller.signal.aborted) {
          return;
        }

        setState({
          status: "success",
          page,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Не удалось загрузить доступные элементы",
        });
      }
    }

    void loadItems();

    return () => controller.abort();
  }, []);

  return state;
}
